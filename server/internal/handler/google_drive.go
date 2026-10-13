package handler

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/integrations/gdrive"
	"github.com/multica-ai/multica/server/internal/logger"
	"github.com/multica-ai/multica/server/internal/service"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// Issue folders live at <project folder>/<driveResourcesFolder>/<ISSUE-KEY>.
const driveResourcesFolder = "Resources"

func nonEmptyTextPtr(t pgtype.Text) *string {
	if !t.Valid || t.String == "" {
		return nil
	}
	s := t.String
	return &s
}

func driveFolderURLPtr(id pgtype.Text) *string {
	if !id.Valid || id.String == "" {
		return nil
	}
	u := service.DriveFolderURL(id.String)
	return &u
}

// acceptProjectDriveFolder turns a pasted folder link or ID into a folder ID,
// checking with Drive (when the integration is on) that the Drive account can
// reach it. It writes the error response itself.
func (h *Handler) acceptProjectDriveFolder(w http.ResponseWriter, r *http.Request, input string) (string, bool) {
	folderID, err := gdrive.ParseFolderID(input)
	if err != nil {
		writeErrorCode(w, http.StatusBadRequest, "drive_folder_invalid", "Paste a Google Drive folder link or folder ID.")
		return "", false
	}
	if h.GoogleDrive == nil {
		return folderID, true
	}
	if _, err := h.GoogleDrive.GetFolder(r.Context(), folderID); err != nil {
		h.writeDriveError(w, r, err)
		return "", false
	}
	return folderID, true
}

// writeDriveError maps Drive failures to messages a workspace admin can act on.
func (h *Handler) writeDriveError(w http.ResponseWriter, r *http.Request, err error) {
	account := "The Drive account"
	if h.GoogleDrive != nil && !errors.Is(err, gdrive.ErrRefreshTokenRevoked) {
		if email := h.GoogleDrive.AccountEmail(r.Context()); email != "" {
			account = "The Drive account " + email
		}
	}
	switch {
	case errors.Is(err, gdrive.ErrRefreshTokenRevoked):
		slog.Error("Google Drive refresh token was revoked or expired; generate a new one and update GOOGLE_DRIVE_REFRESH_TOKEN",
			logger.RequestAttrs(r)...)
		writeErrorCode(w, http.StatusServiceUnavailable, "drive_token_revoked",
			"Google Drive access has expired on this server. Ask an admin to reconnect it.")
	case errors.Is(err, gdrive.ErrNotFound):
		writeErrorCode(w, http.StatusUnprocessableEntity, "drive_folder_inaccessible",
			fmt.Sprintf("%s can't access this folder. Add it to the Shared Drive as Content manager.", account))
	case errors.Is(err, gdrive.ErrNotFolder):
		writeErrorCode(w, http.StatusUnprocessableEntity, "drive_folder_not_folder", "This link points to a file, not a folder.")
	case errors.Is(err, gdrive.ErrForbidden):
		writeErrorCode(w, http.StatusUnprocessableEntity, "drive_folder_read_only",
			fmt.Sprintf("%s can see this folder but can't create folders in it. Give it Content manager access.", account))
	default:
		slog.Warn("google drive request failed", append(logger.RequestAttrs(r), "error", err)...)
		writeErrorCode(w, http.StatusBadGateway, "drive_unavailable", "Couldn't reach Google Drive. Try again.")
	}
}

// DriveFolderResponse is returned by CreateIssueDriveFolder.
type DriveFolderResponse struct {
	DriveFolderID  string `json:"drive_folder_id"`
	DriveFolderURL string `json:"drive_folder_url"`
}

// CreateIssueDriveFolder makes sure the issue has a Google Drive folder at
// <project folder>/Resources/<ISSUE-KEY> and returns it. Repeating the call,
// or racing it, returns the same folder.
func (h *Handler) CreateIssueDriveFolder(w http.ResponseWriter, r *http.Request) {
	issue, ok := h.loadIssueForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	if issue.DriveFolderID.Valid && issue.DriveFolderID.String != "" {
		writeJSON(w, http.StatusOK, driveFolderResponse(issue.DriveFolderID.String))
		return
	}
	if h.GoogleDrive == nil {
		writeErrorCode(w, http.StatusConflict, "google_drive_disabled", "Google Drive isn't set up on this server.")
		return
	}
	if !issue.ProjectID.Valid {
		writeErrorCode(w, http.StatusUnprocessableEntity, "issue_has_no_project", "Add the issue to a project first.")
		return
	}
	project, err := h.Queries.GetProjectInWorkspace(r.Context(), db.GetProjectInWorkspaceParams{
		ID: issue.ProjectID, WorkspaceID: issue.WorkspaceID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}
	if !project.DriveFolderID.Valid || project.DriveFolderID.String == "" {
		writeErrorCode(w, http.StatusUnprocessableEntity, "project_drive_folder_missing",
			"Link a Google Drive folder in the project settings first.")
		return
	}

	identifier := service.IssueIdentifier(h.getIssuePrefix(r.Context(), issue.WorkspaceID), issue.Number)
	folderID, err := h.createIssueDriveFolder(r.Context(), issue, project.DriveFolderID.String, identifier)
	if err != nil {
		var driveErr driveCallError
		if errors.As(err, &driveErr) {
			h.writeDriveError(w, r, driveErr.err)
			return
		}
		slog.Warn("create issue drive folder failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to save the drive folder")
		return
	}

	issue.DriveFolderID = pgtype.Text{String: folderID, Valid: true}
	resp := issueToResponse(issue, h.getIssuePrefix(r.Context(), issue.WorkspaceID))
	h.fillStatusCategory(r.Context(), issue.WorkspaceID, &resp)
	workspaceID := uuidToString(issue.WorkspaceID)
	actorType, actorID := h.resolveActor(r, requestUserID(r), workspaceID)
	h.publish(protocol.EventIssueUpdated, workspaceID, actorType, actorID, map[string]any{"issue": resp})
	writeJSON(w, http.StatusOK, driveFolderResponse(folderID))
}

func driveFolderResponse(id string) DriveFolderResponse {
	return DriveFolderResponse{DriveFolderID: id, DriveFolderURL: service.DriveFolderURL(id)}
}

// driveCallError marks a failure that came from Google rather than from us.
type driveCallError struct{ err error }

func (e driveCallError) Error() string { return e.err.Error() }

// createIssueDriveFolder finds or creates the folders under a per-project
// advisory lock, so two clicks (or two issues creating "Resources" at once)
// cannot leave duplicate folders behind, then records the result.
func (h *Handler) createIssueDriveFolder(ctx context.Context, issue db.Issue, projectFolderID, identifier string) (string, error) {
	tx, err := h.TxStarter.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
		"google_drive_folder:"+uuidToString(issue.ProjectID)); err != nil {
		return "", err
	}
	qtx := h.Queries.WithTx(tx)
	current, err := qtx.GetIssue(ctx, issue.ID)
	if err != nil {
		return "", err
	}
	if current.DriveFolderID.Valid && current.DriveFolderID.String != "" {
		return current.DriveFolderID.String, tx.Commit(ctx)
	}

	resources, err := h.GoogleDrive.FindOrCreateFolder(ctx, projectFolderID, driveResourcesFolder)
	if err != nil {
		return "", driveCallError{err}
	}
	folder, err := h.GoogleDrive.FindOrCreateFolder(ctx, resources.ID, identifier)
	if err != nil {
		return "", driveCallError{err}
	}
	stored, err := qtx.ClaimIssueDriveFolder(ctx, db.ClaimIssueDriveFolderParams{
		DriveFolderID: folder.ID,
		IssueID:       issue.ID,
		WorkspaceID:   issue.WorkspaceID,
	})
	if err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	if stored.Valid && stored.String != "" {
		return stored.String, nil
	}
	return folder.ID, nil
}

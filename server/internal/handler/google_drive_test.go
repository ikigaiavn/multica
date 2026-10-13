package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/internal/integrations/gdrive"
	"github.com/multica-ai/multica/server/internal/integrations/gdrive/gdrivetest"
	"github.com/multica-ai/multica/server/internal/service"
	"github.com/multica-ai/multica/server/internal/testutil"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

const testProjectDriveFolderID = "1ProjectFolderBlum02"

// useGoogleDrive points testHandler at a fake Drive holding the project
// folder, and restores the previous client afterwards.
func useGoogleDrive(t *testing.T) *gdrivetest.Server {
	t.Helper()
	fake := gdrivetest.New(t)
	fake.AddFolder(testProjectDriveFolderID, "02-Blum", "")
	prev := testHandler.GoogleDrive
	testHandler.GoogleDrive = fake.Client(t)
	t.Cleanup(func() { testHandler.GoogleDrive = prev })
	return fake
}

func withoutGoogleDrive(t *testing.T) {
	t.Helper()
	prev := testHandler.GoogleDrive
	testHandler.GoogleDrive = nil
	t.Cleanup(func() { testHandler.GoogleDrive = prev })
}

func postIssueDriveFolder(t *testing.T, issueID string) (*httptest.ResponseRecorder, DriveFolderResponse) {
	t.Helper()
	w := httptest.NewRecorder()
	req := withURLParam(newRequest("POST", "/api/issues/"+issueID+"/drive-folder", nil), "id", issueID)
	testHandler.CreateIssueDriveFolder(w, req)
	var resp DriveFolderResponse
	if w.Code == http.StatusOK {
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode drive folder response: %v", err)
		}
	}
	return w, resp
}

func errorCode(t *testing.T, w *httptest.ResponseRecorder) string {
	t.Helper()
	var body struct {
		Code string `json:"code"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	return body.Code
}

func TestProjectDriveFolder_LinkValidateClear(t *testing.T) {
	fake := useGoogleDrive(t)
	fake.AddFile("1SomeSpreadsheetFile", "budget.xlsx", testProjectDriveFolderID)
	project, code, body := createProjectForAvatarTest(t, map[string]any{"title": "drive project"})
	if code != http.StatusCreated {
		t.Fatalf("create: %d %s", code, body)
	}
	if project.DriveFolderID != nil || project.DriveFolderURL != nil {
		t.Fatalf("new project has a drive folder: %v", project.DriveFolderID)
	}

	link := "https://drive.google.com/drive/u/0/folders/" + testProjectDriveFolderID + "?usp=sharing"
	updated, code, body := updateProjectForAvatarTest(t, project.ID, map[string]any{"drive_folder": link})
	if code != http.StatusOK {
		t.Fatalf("link: %d %s", code, body)
	}
	if updated.DriveFolderID == nil || *updated.DriveFolderID != testProjectDriveFolderID {
		t.Fatalf("drive_folder_id = %v, want %q", updated.DriveFolderID, testProjectDriveFolderID)
	}
	if updated.DriveFolderURL == nil || *updated.DriveFolderURL != gdrive.FolderURL(testProjectDriveFolderID) {
		t.Fatalf("drive_folder_url = %v", updated.DriveFolderURL)
	}

	// Editing another field keeps the folder.
	renamed, code, body := updateProjectForAvatarTest(t, project.ID, map[string]any{"title": "drive project renamed"})
	if code != http.StatusOK || renamed.DriveFolderID == nil {
		t.Fatalf("rename dropped the folder: %d %s", code, body)
	}

	_, code, body = updateProjectForAvatarTest(t, project.ID, map[string]any{"drive_folder": "not a link"})
	if code != http.StatusBadRequest {
		t.Fatalf("invalid input: %d %s", code, body)
	}
	_, code, body = updateProjectForAvatarTest(t, project.ID, map[string]any{"drive_folder": "1NobodySharedThisOne"})
	if code != http.StatusUnprocessableEntity || !strings.Contains(body, gdrivetest.AccountEmail) {
		t.Fatalf("inaccessible folder: %d %s (want 422 naming the Drive account)", code, body)
	}
	_, code, body = updateProjectForAvatarTest(t, project.ID, map[string]any{"drive_folder": "1SomeSpreadsheetFile"})
	if code != http.StatusUnprocessableEntity || !strings.Contains(body, "drive_folder_not_folder") {
		t.Fatalf("file instead of folder: %d %s", code, body)
	}

	cleared, code, body := updateProjectForAvatarTest(t, project.ID, map[string]any{"drive_folder": ""})
	if code != http.StatusOK || cleared.DriveFolderID != nil {
		t.Fatalf("clear: %d %s, drive_folder_id=%v", code, body, cleared.DriveFolderID)
	}
}

func TestProjectDriveFolder_StoredUnverifiedWhenIntegrationOff(t *testing.T) {
	withoutGoogleDrive(t)
	project, code, body := createProjectForAvatarTest(t, map[string]any{"title": "drive off project"})
	if code != http.StatusCreated {
		t.Fatalf("create: %d %s", code, body)
	}
	updated, code, body := updateProjectForAvatarTest(t, project.ID, map[string]any{"drive_folder": testProjectDriveFolderID})
	if code != http.StatusOK || updated.DriveFolderID == nil {
		t.Fatalf("link without integration: %d %s", code, body)
	}
}

func issueInDriveProject(t *testing.T, linkFolder bool) (issueID, identifier string) {
	t.Helper()
	project, code, body := createProjectForAvatarTest(t, map[string]any{"title": "drive issue project"})
	if code != http.StatusCreated {
		t.Fatalf("create project: %d %s", code, body)
	}
	if linkFolder {
		if _, code, body := updateProjectForAvatarTest(t, project.ID, map[string]any{"drive_folder": testProjectDriveFolderID}); code != http.StatusOK {
			t.Fatalf("link folder: %d %s", code, body)
		}
	}
	issueID = dbfx.Issue(t, "Add badges to menu", testutil.Cols{"project_id": project.ID})
	var number int32
	dbfx.QueryRow(t, `SELECT number FROM issue WHERE id = $1`, issueID).Scan(&number)
	prefix := testHandler.getIssuePrefix(context.Background(), parseUUID(testWorkspaceID))
	return issueID, service.IssueIdentifier(prefix, number)
}

func TestCreateIssueDriveFolder_CreatesOnceUnderResources(t *testing.T) {
	fake := useGoogleDrive(t)
	issueID, identifier := issueInDriveProject(t, true)

	w, first := postIssueDriveFolder(t, issueID)
	if w.Code != http.StatusOK {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	resources := fake.Children(testProjectDriveFolderID)
	if len(resources) != 1 || resources[0].Name != "Resources" {
		t.Fatalf("project folder children = %+v, want one Resources folder", resources)
	}
	issueFolders := fake.Children(resources[0].ID)
	if len(issueFolders) != 1 || issueFolders[0].Name != identifier || issueFolders[0].ID != first.DriveFolderID {
		t.Fatalf("Resources children = %+v, want %s (%s)", issueFolders, identifier, first.DriveFolderID)
	}
	if first.DriveFolderURL != gdrive.FolderURL(first.DriveFolderID) {
		t.Fatalf("url = %q", first.DriveFolderURL)
	}
	var stored string
	dbfx.QueryRow(t, `SELECT drive_folder_id FROM issue WHERE id = $1`, issueID).Scan(&stored)
	if stored != first.DriveFolderID {
		t.Fatalf("stored drive_folder_id = %q, want %q", stored, first.DriveFolderID)
	}

	creates := fake.CreateCalls
	w, second := postIssueDriveFolder(t, issueID)
	if w.Code != http.StatusOK || second.DriveFolderID != first.DriveFolderID || fake.CreateCalls != creates {
		t.Fatalf("second call: %d %+v, creates %d -> %d", w.Code, second, creates, fake.CreateCalls)
	}

	// The issue detail payload carries the link.
	resp := issueToResponse(mustGetIssue(t, issueID), "X")
	if resp.DriveFolderURL == nil || *resp.DriveFolderURL != first.DriveFolderURL {
		t.Fatalf("issue response drive_folder_url = %v", resp.DriveFolderURL)
	}
}

func TestCreateIssueDriveFolder_ReusesExistingFolders(t *testing.T) {
	fake := useGoogleDrive(t)
	issueID, identifier := issueInDriveProject(t, true)
	fake.AddFolder("1ExistingResources01", "Resources", testProjectDriveFolderID)
	fake.AddFolder("1ExistingIssueFolder", identifier, "1ExistingResources01")

	w, got := postIssueDriveFolder(t, issueID)
	if w.Code != http.StatusOK || got.DriveFolderID != "1ExistingIssueFolder" {
		t.Fatalf("reuse: %d %s %+v", w.Code, w.Body.String(), got)
	}
	if fake.CreateCalls != 0 {
		t.Fatalf("created %d folders, want 0", fake.CreateCalls)
	}
}

func TestCreateIssueDriveFolder_Errors(t *testing.T) {
	t.Run("integration off", func(t *testing.T) {
		withoutGoogleDrive(t)
		issueID, _ := issueInDriveProject(t, true)
		w, _ := postIssueDriveFolder(t, issueID)
		if w.Code != http.StatusConflict || errorCode(t, w) != "google_drive_disabled" {
			t.Fatalf("%d %s", w.Code, w.Body.String())
		}
	})
	t.Run("no project", func(t *testing.T) {
		useGoogleDrive(t)
		issueID := dbfx.Issue(t, "Loose issue")
		w, _ := postIssueDriveFolder(t, issueID)
		if w.Code != http.StatusUnprocessableEntity || errorCode(t, w) != "issue_has_no_project" {
			t.Fatalf("%d %s", w.Code, w.Body.String())
		}
	})
	t.Run("project without folder", func(t *testing.T) {
		useGoogleDrive(t)
		issueID, _ := issueInDriveProject(t, false)
		w, _ := postIssueDriveFolder(t, issueID)
		if w.Code != http.StatusUnprocessableEntity || errorCode(t, w) != "project_drive_folder_missing" {
			t.Fatalf("%d %s", w.Code, w.Body.String())
		}
	})
	t.Run("revoked refresh token", func(t *testing.T) {
		fake := useGoogleDrive(t)
		issueID, _ := issueInDriveProject(t, true)
		// A fresh client, so the token cached while linking the folder is gone.
		testHandler.GoogleDrive = fake.Client(t)
		fake.RevokeRefreshToken = true
		w, _ := postIssueDriveFolder(t, issueID)
		if w.Code != http.StatusServiceUnavailable || errorCode(t, w) != "drive_token_revoked" {
			t.Fatalf("%d %s", w.Code, w.Body.String())
		}
	})
	t.Run("read-only project folder", func(t *testing.T) {
		fake := useGoogleDrive(t)
		issueID, _ := issueInDriveProject(t, true)
		fake.Forbidden[testProjectDriveFolderID] = true
		w, _ := postIssueDriveFolder(t, issueID)
		if w.Code != http.StatusUnprocessableEntity || errorCode(t, w) != "drive_folder_read_only" {
			t.Fatalf("%d %s", w.Code, w.Body.String())
		}
		var stored *string
		dbfx.QueryRow(t, `SELECT drive_folder_id FROM issue WHERE id = $1`, issueID).Scan(&stored)
		if stored != nil {
			t.Fatalf("a failed create recorded %q", *stored)
		}
	})
}

func mustGetIssue(t *testing.T, issueID string) db.Issue {
	t.Helper()
	issue, err := testHandler.Queries.GetIssue(context.Background(), parseUUID(issueID))
	if err != nil {
		t.Fatalf("GetIssue: %v", err)
	}
	return issue
}

func TestGetConfigReportsGoogleDrive(t *testing.T) {
	fetch := func() map[string]json.RawMessage {
		t.Helper()
		w := httptest.NewRecorder()
		testHandler.GetConfig(w, httptest.NewRequest(http.MethodGet, "/api/config", nil))
		var cfg map[string]json.RawMessage
		if err := json.Unmarshal(w.Body.Bytes(), &cfg); err != nil {
			t.Fatalf("decode config: %v", err)
		}
		return cfg
	}
	withoutGoogleDrive(t)
	if _, ok := fetch()["google_drive_enabled"]; ok {
		t.Fatal("google_drive_enabled must be omitted when Drive is not configured")
	}
	useGoogleDrive(t)
	if got := string(fetch()["google_drive_enabled"]); got != "true" {
		t.Fatalf("google_drive_enabled = %s, want true", got)
	}
}

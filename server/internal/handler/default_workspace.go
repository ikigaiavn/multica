package handler

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/multica-ai/multica/server/internal/issuestatus"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// DefaultWorkspaceConfig puts every signed-in user into one company
// workspace, for internal deployments that have no onboarding flow. The
// first user to sign in creates the workspace and owns it; everyone after
// joins as a member (or with the role of a pending invitation they hold).
type DefaultWorkspaceConfig struct {
	Slug string
	Name string
}

// ValidateDefaultWorkspaceSlug reports why slug cannot be used as the
// default workspace, so the server can refuse to start on a typo instead of
// failing every login.
func ValidateDefaultWorkspaceSlug(slug string) error {
	if !workspaceSlugPattern.MatchString(slug) {
		return fmt.Errorf("DEFAULT_WORKSPACE_SLUG %q must contain only lowercase letters, numbers, and hyphens", slug)
	}
	if isReservedSlug(slug) {
		return fmt.Errorf("DEFAULT_WORKSPACE_SLUG %q is reserved", slug)
	}
	return nil
}

// ensureDefaultWorkspace makes user a member of the configured default
// workspace and marks them onboarded, returning the refreshed user. It is a
// no-op when no default workspace is configured. Callers treat errors as
// non-fatal: the login still succeeds and the user can be added manually.
func (h *Handler) ensureDefaultWorkspace(ctx context.Context, user db.User) (db.User, error) {
	slug := h.cfg.DefaultWorkspace.Slug
	if slug == "" {
		return user, nil
	}
	if h.seatCapacityEnabled() {
		// Managed seat billing needs a capacity claim per join; the default
		// workspace is a self-host feature and does not take part in it.
		return user, errors.New("default workspace is not supported with managed seat capacity")
	}

	// A concurrent first login can create the workspace between our lookup
	// and insert; the retry then finds it and joins as a member.
	for attempt := 0; ; attempt++ {
		updated, joined, err := h.joinDefaultWorkspaceTx(ctx, user, slug)
		if err != nil && isUniqueViolation(err) && attempt == 0 {
			continue
		}
		if err != nil {
			return user, err
		}
		if joined != nil {
			h.announceDefaultWorkspaceJoin(updated, *joined)
		}
		return updated, nil
	}
}

type defaultWorkspaceJoin struct {
	workspace db.Workspace
	member    db.Member
	created   bool
}

func (h *Handler) joinDefaultWorkspaceTx(ctx context.Context, user db.User, slug string) (db.User, *defaultWorkspaceJoin, error) {
	tx, err := h.TxStarter.Begin(ctx)
	if err != nil {
		return user, nil, err
	}
	defer tx.Rollback(ctx)
	qtx := h.Queries.WithTx(tx)

	var join *defaultWorkspaceJoin
	ws, err := qtx.GetWorkspaceBySlug(ctx, slug)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		name := strings.TrimSpace(h.cfg.DefaultWorkspace.Name)
		if name == "" {
			name = slug
		}
		ws, err = qtx.CreateWorkspace(ctx, db.CreateWorkspaceParams{
			Name:        name,
			Slug:        slug,
			IssuePrefix: defaultIssuePrefixFromSlug(slug),
		})
		if err != nil {
			return user, nil, err
		}
		member, err := qtx.CreateMember(ctx, db.CreateMemberParams{
			WorkspaceID: ws.ID,
			UserID:      user.ID,
			Role:        "owner",
		})
		if err != nil {
			return user, nil, err
		}
		if err := issuestatus.Ensure(ctx, qtx, ws.ID); err != nil {
			return user, nil, err
		}
		join = &defaultWorkspaceJoin{workspace: ws, member: member, created: true}
	case err != nil:
		return user, nil, err
	default:
		_, memberErr := qtx.GetMemberByUserAndWorkspace(ctx, db.GetMemberByUserAndWorkspaceParams{
			UserID:      user.ID,
			WorkspaceID: ws.ID,
		})
		switch {
		case memberErr == nil:
			// Already a member, which is every login after the first.
		case errors.Is(memberErr, pgx.ErrNoRows):
			role := "member"
			// Settle a pending invitation to this workspace so it does not
			// linger in the user's list; its role wins over the default.
			inv, invErr := qtx.GetPendingInvitationByEmail(ctx, db.GetPendingInvitationByEmailParams{
				WorkspaceID:  ws.ID,
				InviteeEmail: strings.ToLower(user.Email),
			})
			switch {
			case invErr == nil:
				accepted, acceptErr := qtx.AcceptInvitation(ctx, inv.ID)
				switch {
				case acceptErr == nil:
					role = accepted.Role
				case errors.Is(acceptErr, pgx.ErrNoRows):
					// Concluded elsewhere in between.
				default:
					return user, nil, acceptErr
				}
			case errors.Is(invErr, pgx.ErrNoRows):
			default:
				return user, nil, invErr
			}
			member, err := qtx.CreateMember(ctx, db.CreateMemberParams{
				WorkspaceID: ws.ID,
				UserID:      user.ID,
				Role:        role,
			})
			if err != nil {
				return user, nil, err
			}
			join = &defaultWorkspaceJoin{workspace: ws, member: member}
		default:
			return user, nil, memberErr
		}
	}

	// There is no onboarding flow; every user who reaches the app is set up.
	updated := user
	if !user.OnboardedAt.Valid {
		updated, err = qtx.MarkUserOnboarded(ctx, user.ID)
		if err != nil {
			return user, nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return user, nil, err
	}
	return updated, join, nil
}

func (h *Handler) announceDefaultWorkspaceJoin(user db.User, join defaultWorkspaceJoin) {
	userID := uuidToString(user.ID)
	wsID := uuidToString(join.workspace.ID)
	slog.Info("user joined default workspace",
		"user_id", userID, "workspace_id", wsID, "role", join.member.Role, "created_workspace", join.created)
	if !join.created {
		h.publish(protocol.EventMemberAdded, wsID, "member", userID, map[string]any{
			"member":         h.memberWithUserResponse(join.member, user),
			"workspace_name": join.workspace.Name,
		})
	}
	h.notifyDaemonWorkspacesChanged(userID)
}

// loginUser runs the post-authentication steps shared by every login method.
func (h *Handler) loginUser(ctx context.Context, user db.User, attrs []any) db.User {
	updated, err := h.ensureDefaultWorkspace(ctx, user)
	if err != nil {
		slog.Warn("default workspace join failed", append(attrs, "error", err, "user_id", uuidToString(user.ID))...)
	}
	return updated
}

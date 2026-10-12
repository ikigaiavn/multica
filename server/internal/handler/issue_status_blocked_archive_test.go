package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	"github.com/multica-ai/multica/server/internal/issuestatus"
	"github.com/multica-ai/multica/server/internal/testutil"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// blockedEntryForTest returns the shared workspace's Blocked row with no issue
// on it, and puts both back when the test ends: the row unarchived, and any
// issue another test left on Blocked returned to it.
func blockedEntryForTest(t *testing.T) db.IssueStatus {
	t.Helper()
	ctx := context.Background()
	seedTestCatalog(t)
	ws := parseUUID(testWorkspaceID)
	entry, err := testHandler.Queries.GetIssueStatusEntryByKey(ctx, db.GetIssueStatusEntryByKeyParams{
		WorkspaceID: ws, Key: issuestatus.Blocked,
	})
	if err != nil {
		t.Fatalf("load blocked entry: %v", err)
	}
	rows, err := testPool.Query(ctx,
		`UPDATE issue SET status = 'in_progress' WHERE workspace_id = $1 AND status = 'blocked' RETURNING id`, ws)
	if err != nil {
		t.Fatalf("park blocked issues: %v", err)
	}
	var parked []any
	for rows.Next() {
		var id any
		if err := rows.Scan(&id); err != nil {
			t.Fatalf("scan parked issue: %v", err)
		}
		parked = append(parked, id)
	}
	rows.Close()
	t.Cleanup(func() {
		testPool.Exec(ctx, `UPDATE issue_status SET archived_at = NULL WHERE id = $1`, entry.ID)
		for _, id := range parked {
			testPool.Exec(ctx, `UPDATE issue SET status = 'blocked' WHERE id = $1`, id)
		}
	})
	return entry
}

func restoreStatusVia(t *testing.T, entry db.IssueStatus) int {
	t.Helper()
	rec := httptest.NewRecorder()
	testHandler.RestoreIssueStatus(rec, withURLParam(
		newRequest(http.MethodPost, "/api/issue-statuses/"+uuidToString(entry.ID)+"/restore", nil),
		"id", uuidToString(entry.ID)))
	return rec.Code
}

func TestBlockedCanBeArchivedOnlyWhenEmpty(t *testing.T) {
	ctx := context.Background()
	entry := blockedEntryForTest(t)

	issueID := mustCreateIssue(t, "blocked archive occupant", "blocked")
	if code := archiveStatusVia(t, entry); code != http.StatusConflict {
		t.Fatalf("archive with an issue on Blocked = %d, want 409", code)
	}

	move := withURLParam(newRequest(http.MethodPatch, "/api/issues/"+uuidToString(issueID),
		map[string]any{"status": "in_progress"}), "id", uuidToString(issueID))
	testutil.Call(t, testHandler.UpdateIssue, move).Want(http.StatusOK)
	if code := archiveStatusVia(t, entry); code != http.StatusOK {
		t.Fatalf("archive empty Blocked = %d, want 200", code)
	}

	keys, err := issuestatus.ActiveKeys(ctx, testHandler.Queries, parseUUID(testWorkspaceID))
	if err != nil {
		t.Fatalf("active keys: %v", err)
	}
	if slices.Contains(keys, issuestatus.Blocked) {
		t.Fatalf("archived Blocked still offered as active: %v", keys)
	}
}

func TestWritesRejectArchivedBlocked(t *testing.T) {
	entry := blockedEntryForTest(t)
	if code := archiveStatusVia(t, entry); code != http.StatusOK {
		t.Fatalf("archive Blocked = %d", code)
	}

	rec := httptest.NewRecorder()
	testHandler.CreateIssue(rec, newRequest(http.MethodPost, "/api/issues", map[string]any{
		"title": "create on archived blocked", "status": "blocked",
	}))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("create on archived Blocked = %d, want 400: %s", rec.Code, rec.Body.String())
	}

	seed := mustCreateIssue(t, "update onto archived blocked", "todo")
	rec = httptest.NewRecorder()
	testHandler.UpdateIssue(rec, withURLParam(
		newRequest(http.MethodPatch, "/api/issues/"+uuidToString(seed), map[string]any{"status": "blocked"}),
		"id", uuidToString(seed)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("update onto archived Blocked = %d, want 400: %s", rec.Code, rec.Body.String())
	}

	if code := restoreStatusVia(t, entry); code != http.StatusOK {
		t.Fatalf("restore Blocked = %d, want 200", code)
	}
	rec = httptest.NewRecorder()
	testHandler.UpdateIssue(rec, withURLParam(
		newRequest(http.MethodPatch, "/api/issues/"+uuidToString(seed), map[string]any{"status": "blocked"}),
		"id", uuidToString(seed)))
	if rec.Code != http.StatusOK {
		t.Fatalf("update onto restored Blocked = %d, want 200: %s", rec.Code, rec.Body.String())
	}
}

func TestOtherBuiltInsStayLocked(t *testing.T) {
	ctx := context.Background()
	seedTestCatalog(t)
	for _, key := range issuestatus.Canonical() {
		if key == issuestatus.Blocked {
			continue
		}
		entry, err := testHandler.Queries.GetIssueStatusEntryByKey(ctx, db.GetIssueStatusEntryByKeyParams{
			WorkspaceID: parseUUID(testWorkspaceID), Key: key,
		})
		if err != nil {
			t.Fatalf("load %s: %v", key, err)
		}
		if code := archiveStatusVia(t, entry); code != http.StatusForbidden {
			t.Errorf("archive %s = %d, want 403", key, code)
		}
		if code := restoreStatusVia(t, entry); code != http.StatusForbidden {
			t.Errorf("restore %s = %d, want 403", key, code)
		}
	}

	custom := createTestCustomStatus(t, "restore_custom_locked", issuestatus.InProgress)
	if code := archiveStatusVia(t, custom); code != http.StatusOK {
		t.Fatalf("archive custom = %d", code)
	}
	if code := restoreStatusVia(t, custom); code != http.StatusForbidden {
		t.Fatalf("restore custom = %d, want 403", code)
	}
}

func TestClaimCarriesArchivedBlocked(t *testing.T) {
	ctx := context.Background()
	entry := blockedEntryForTest(t)
	if code := archiveStatusVia(t, entry); code != http.StatusOK {
		t.Fatalf("archive Blocked = %d", code)
	}

	runtimeID := createClaimReclaimRuntime(t, ctx, "Archived blocked claim runtime")
	agentID, issueID := createClaimReclaimAgentAndIssue(t, ctx, runtimeID, "Archived blocked claim agent")
	taskID := createDispatchedClaimFixtureTask(t, ctx, agentID, runtimeID, issueID, "120 seconds", false)

	req := newDaemonTokenRequest("POST", "/api/daemon/runtimes/"+runtimeID+"/tasks/claim", nil,
		testWorkspaceID, "archived-blocked-claim")
	req = withURLParam(req, "runtimeId", runtimeID)
	var resp struct {
		Task *struct {
			ID               string   `json:"id"`
			ArchivedBuiltIns []string `json:"archived_built_in_statuses"`
			IssueStatuses    []struct {
				Key string `json:"key"`
			} `json:"issue_statuses"`
		} `json:"task"`
	}
	testutil.Call(t, testHandler.ClaimTaskByRuntime, req).Want(http.StatusOK).JSON(&resp)
	if resp.Task == nil || resp.Task.ID != taskID {
		t.Fatalf("expected task %s to be claimed, got %+v", taskID, resp.Task)
	}
	if !slices.Equal(resp.Task.ArchivedBuiltIns, []string{issuestatus.Blocked}) {
		t.Fatalf("archived_built_in_statuses = %v, want [blocked]", resp.Task.ArchivedBuiltIns)
	}
	for _, s := range resp.Task.IssueStatuses {
		if s.Key == issuestatus.Blocked {
			t.Fatalf("built-in Blocked leaked into custom issue_statuses")
		}
	}
}

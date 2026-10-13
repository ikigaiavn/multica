package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func createProjectForAvatarTest(t *testing.T, body map[string]any) (ProjectResponse, int, string) {
	t.Helper()
	w := httptest.NewRecorder()
	testHandler.CreateProject(w, newRequest("POST", "/api/projects?workspace_id="+testWorkspaceID, body))
	if w.Code != http.StatusCreated {
		return ProjectResponse{}, w.Code, w.Body.String()
	}
	var project ProjectResponse
	if err := json.NewDecoder(w.Body).Decode(&project); err != nil {
		t.Fatalf("decode CreateProject: %v", err)
	}
	t.Cleanup(func() {
		req := withURLParam(newRequest("DELETE", "/api/projects/"+project.ID, nil), "id", project.ID)
		testHandler.DeleteProject(httptest.NewRecorder(), req)
	})
	return project, w.Code, ""
}

func updateProjectForAvatarTest(t *testing.T, id string, body map[string]any) (ProjectResponse, int, string) {
	t.Helper()
	w := httptest.NewRecorder()
	req := withURLParam(newRequest("PUT", "/api/projects/"+id, body), "id", id)
	testHandler.UpdateProject(w, req)
	if w.Code != http.StatusOK {
		return ProjectResponse{}, w.Code, w.Body.String()
	}
	var project ProjectResponse
	if err := json.NewDecoder(w.Body).Decode(&project); err != nil {
		t.Fatalf("decode UpdateProject: %v", err)
	}
	return project, w.Code, ""
}

// An uploaded image becomes the project icon, comes back through the signed
// avatar endpoint on private storage, and can be removed again.
func TestProjectAvatarURL_CreateUpdateClear(t *testing.T) {
	withAvatarStorage(t, &mockStorageNoCdn{}, "")
	key := seedAvatarObject(t, avatarObjectOpts{})
	raw := "https://cdn.example.com/" + key
	signed := avatarURLPathPrefix + signAvatarKey(key) + "/" + key

	project, code, body := createProjectForAvatarTest(t, map[string]any{
		"title":      "avatar project",
		"icon":       "🚀",
		"avatar_url": raw,
	})
	if code != http.StatusCreated {
		t.Fatalf("create: %d %s", code, body)
	}
	if project.AvatarURL == nil || *project.AvatarURL != signed {
		t.Fatalf("create avatar_url = %v, want signed %q", project.AvatarURL, signed)
	}
	if project.Icon == nil || *project.Icon != "🚀" {
		t.Fatalf("emoji fallback lost: %v", project.Icon)
	}

	// Round-tripping the resolved value is an unchanged re-send.
	updated, code, body := updateProjectForAvatarTest(t, project.ID, map[string]any{"avatar_url": *project.AvatarURL})
	if code != http.StatusOK {
		t.Fatalf("resend: %d %s", code, body)
	}
	if updated.AvatarURL == nil || *updated.AvatarURL != signed {
		t.Fatalf("resend avatar_url = %v, want %q", updated.AvatarURL, signed)
	}

	// Editing another field leaves the image alone.
	updated, code, body = updateProjectForAvatarTest(t, project.ID, map[string]any{"title": "renamed"})
	if code != http.StatusOK {
		t.Fatalf("rename: %d %s", code, body)
	}
	if updated.AvatarURL == nil {
		t.Fatalf("rename cleared avatar_url")
	}

	for _, clear := range []any{nil, ""} {
		if _, code, body := updateProjectForAvatarTest(t, project.ID, map[string]any{"avatar_url": raw}); code != http.StatusOK {
			t.Fatalf("set: %d %s", code, body)
		}
		updated, code, body = updateProjectForAvatarTest(t, project.ID, map[string]any{"avatar_url": clear})
		if code != http.StatusOK {
			t.Fatalf("clear with %#v: %d %s", clear, code, body)
		}
		if updated.AvatarURL != nil {
			t.Fatalf("clear with %#v left avatar_url = %q", clear, *updated.AvatarURL)
		}
	}
}

// The project icon is published through the public avatar endpoint, so it is
// held to the same rule as every other avatar: no files attached to issues.
func TestProjectAvatarURL_RejectsBoundAttachment(t *testing.T) {
	withAvatarStorage(t, &mockStorageNoCdn{}, "")
	key := seedAvatarObject(t, avatarObjectOpts{boundToIssue: true})
	raw := "https://cdn.example.com/" + key

	if _, code, _ := createProjectForAvatarTest(t, map[string]any{"title": "bound avatar", "avatar_url": raw}); code != http.StatusForbidden {
		t.Fatalf("create status = %d, want 403", code)
	}

	project, code, body := createProjectForAvatarTest(t, map[string]any{"title": "bound avatar update"})
	if code != http.StatusCreated {
		t.Fatalf("seed: %d %s", code, body)
	}
	if _, code, _ := updateProjectForAvatarTest(t, project.ID, map[string]any{"avatar_url": raw}); code != http.StatusForbidden {
		t.Fatalf("update status = %d, want 403", code)
	}
}

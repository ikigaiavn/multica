package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

const defaultWorkspaceTestSlug = "default-ws-login-test"

func useDefaultWorkspace(t *testing.T, slug, name string) {
	t.Helper()
	prev := testHandler.cfg.DefaultWorkspace
	testHandler.cfg.DefaultWorkspace = DefaultWorkspaceConfig{Slug: slug, Name: name}
	ctx := context.Background()
	cleanup := func() {
		testPool.Exec(ctx, `DELETE FROM issue_status WHERE workspace_id IN (SELECT id FROM workspace WHERE slug = $1)`, slug)
		testPool.Exec(ctx, `DELETE FROM member WHERE workspace_id IN (SELECT id FROM workspace WHERE slug = $1)`, slug)
		testPool.Exec(ctx, `DELETE FROM workspace WHERE slug = $1`, slug)
	}
	cleanup()
	t.Cleanup(func() {
		testHandler.cfg.DefaultWorkspace = prev
		cleanup()
	})
}

func loginWithDevCode(t *testing.T, email string) LoginResponse {
	t.Helper()
	t.Setenv(devVerificationCodeEnv, "888888")
	t.Setenv("APP_ENV", "development")
	ctx := context.Background()
	t.Cleanup(func() {
		testPool.Exec(ctx, `DELETE FROM verification_code WHERE email = $1`, email)
		testPool.Exec(ctx, `DELETE FROM member WHERE user_id IN (SELECT id FROM "user" WHERE email = $1)`, email)
		testPool.Exec(ctx, `DELETE FROM "user" WHERE email = $1`, email)
	})
	createVerificationCodeForTest(t, email, "123456")

	var buf bytes.Buffer
	json.NewEncoder(&buf).Encode(map[string]string{"email": email, "code": "888888"})
	req := httptest.NewRequest("POST", "/auth/verify-code", &buf)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	testHandler.VerifyCode(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("VerifyCode: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp LoginResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode login response: %v", err)
	}
	return resp
}

func defaultWorkspaceRole(t *testing.T, slug, email string) string {
	t.Helper()
	var role string
	err := testPool.QueryRow(context.Background(), `
		SELECT m.role FROM member m
		JOIN workspace w ON w.id = m.workspace_id
		JOIN "user" u ON u.id = m.user_id
		WHERE w.slug = $1 AND u.email = $2`, slug, email).Scan(&role)
	if err != nil {
		t.Fatalf("load %s membership in %s: %v", email, slug, err)
	}
	return role
}

func TestLoginCreatesDefaultWorkspaceForFirstUserThenJoinsOthers(t *testing.T) {
	useDefaultWorkspace(t, defaultWorkspaceTestSlug, "Acme Internal")

	first := loginWithDevCode(t, "default-ws-first@multica.ai")
	if first.User.OnboardedAt == nil {
		t.Fatalf("first user should be marked onboarded")
	}
	if role := defaultWorkspaceRole(t, defaultWorkspaceTestSlug, "default-ws-first@multica.ai"); role != "owner" {
		t.Fatalf("first user role = %q, want owner", role)
	}
	var name string
	var statuses int
	if err := testPool.QueryRow(context.Background(), `
		SELECT w.name, (SELECT count(*) FROM issue_status s WHERE s.workspace_id = w.id)
		FROM workspace w WHERE w.slug = $1`, defaultWorkspaceTestSlug).Scan(&name, &statuses); err != nil {
		t.Fatalf("load default workspace: %v", err)
	}
	if name != "Acme Internal" || statuses == 0 {
		t.Fatalf("default workspace name=%q statuses=%d, want seeded Acme Internal", name, statuses)
	}

	second := loginWithDevCode(t, "default-ws-second@multica.ai")
	if second.User.OnboardedAt == nil {
		t.Fatalf("second user should be marked onboarded")
	}
	if role := defaultWorkspaceRole(t, defaultWorkspaceTestSlug, "default-ws-second@multica.ai"); role != "member" {
		t.Fatalf("second user role = %q, want member", role)
	}

	// Logging in again keeps the single membership.
	loginWithDevCode(t, "default-ws-second@multica.ai")
	var count int
	if err := testPool.QueryRow(context.Background(), `
		SELECT count(*) FROM member m JOIN workspace w ON w.id = m.workspace_id
		WHERE w.slug = $1`, defaultWorkspaceTestSlug).Scan(&count); err != nil {
		t.Fatalf("count members: %v", err)
	}
	if count != 2 {
		t.Fatalf("member count = %d, want 2", count)
	}
}

func TestLoginWithoutDefaultWorkspaceJoinsNothing(t *testing.T) {
	useDefaultWorkspace(t, "", "")

	resp := loginWithDevCode(t, "default-ws-none@multica.ai")
	if resp.User.OnboardedAt != nil {
		t.Fatalf("without a default workspace the login must not change onboarding state")
	}
	var count int
	if err := testPool.QueryRow(context.Background(), `
		SELECT count(*) FROM member m JOIN "user" u ON u.id = m.user_id WHERE u.email = $1`,
		"default-ws-none@multica.ai").Scan(&count); err != nil {
		t.Fatalf("count memberships: %v", err)
	}
	if count != 0 {
		t.Fatalf("memberships = %d, want 0", count)
	}
}

func TestValidateDefaultWorkspaceSlug(t *testing.T) {
	if err := ValidateDefaultWorkspaceSlug("acme-internal"); err != nil {
		t.Fatalf("valid slug rejected: %v", err)
	}
	for _, slug := range []string{"Acme", "acme_internal", "-acme", "login"} {
		if err := ValidateDefaultWorkspaceSlug(slug); err == nil {
			t.Fatalf("slug %q should be rejected", slug)
		}
	}
}

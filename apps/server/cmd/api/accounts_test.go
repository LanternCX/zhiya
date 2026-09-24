package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/LanternCX/zhiya/apps/server/internal/config"
	"github.com/LanternCX/zhiya/apps/server/internal/data"
	"github.com/LanternCX/zhiya/apps/server/internal/objectstore"
	"github.com/jackc/pgx/v5/pgxpool"
)

type testApp struct {
	t       *testing.T
	server  *httptest.Server
	mail    map[string]string
	db      *pgxpool.Pool
	config  config.Config
	objects objectstore.Store
	app     *application
}

func setupAccountTest(t *testing.T) *testApp {
	t.Helper()
	if os.Getenv("ZHIYA_TEST_DATABASE") != "1" {
		t.Skip("run npm run test:accounts to enable PostgreSQL behavior tests")
	}
	configPath := os.Getenv("ZHIYA_SERVER_CONFIG")
	if configPath == "" {
		configPath = "../../config.yaml"
	}
	settings, err := config.Load(configPath)
	if err != nil {
		t.Fatal(err)
	}
	url := settings.Database.URL
	settings.Server.Origin = ""
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	schema := "account_test_" + strings.ReplaceAll(rand.Text()[:24], "-", "")
	if _, err = pool.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	db, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close(); _, _ = pool.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE"); pool.Close() })
	if err := data.NewModels(db, settings.Account).Initialize(ctx); err != nil {
		t.Fatal(err)
	}
	objects := newMemoryObjectStore()
	t.Cleanup(objects.server.Close)
	a := &testApp{t: t, mail: make(map[string]string), db: db, config: settings, objects: objects}
	app := &application{config: settings, models: data.NewModels(db, settings.Account), send: func(to, purpose, code string) error { a.mail[to+":"+purpose] = code; return nil }, learningHub: newLearningHub(), objects: a.objects}
	a.app = app
	listenerContext, stopListener := context.WithCancel(context.Background())
	t.Cleanup(stopListener)
	if err := app.startLearningEvents(listenerContext); err != nil {
		t.Fatal(err)
	}
	a.server = httptest.NewServer(app.routes())
	t.Cleanup(a.server.Close)
	return a
}

func (a *testApp) createCourseConversation(c *http.Client) (string, string) {
	a.t.Helper()
	created := a.request(c, "POST", "/courses", map[string]any{
		"title": "自然科学", "topic": "理解自然现象",
		"cover": map[string]any{"motif": "nature", "palette": "ocean", "label": "SCIENCE"},
	}, http.StatusCreated)["course"].(map[string]any)
	courseID := created["id"].(string)
	outlined := a.request(c, "PUT", "/courses/"+courseID+"/outline", map[string]any{
		"sections": []any{map[string]any{"title": "第一课", "objective": "理解基本概念"}},
	}, http.StatusOK)["course"].(map[string]any)
	sectionID := outlined["sections"].([]any)[0].(map[string]any)["id"].(string)
	conversation := a.request(c, "POST", "/courses/"+courseID+"/sections/"+sectionID+"/conversations", map[string]any{"title": "课堂"}, http.StatusCreated)["conversation"].(map[string]any)
	return courseID, conversation["id"].(string)
}

func (a *testApp) anotherInstance() *testApp {
	a.t.Helper()
	other := &testApp{t: a.t, mail: a.mail, db: a.db, config: a.config, objects: a.objects}
	app := &application{config: a.config, models: data.NewModels(a.db, a.config.Account), send: func(to, purpose, code string) error { a.mail[to+":"+purpose] = code; return nil }, learningHub: newLearningHub(), objects: a.objects}
	listenerContext, stopListener := context.WithCancel(context.Background())
	a.t.Cleanup(stopListener)
	if err := app.startLearningEvents(listenerContext); err != nil {
		a.t.Fatal(err)
	}
	other.server = httptest.NewServer(app.routes())
	a.t.Cleanup(other.server.Close)
	return other
}

func (a *testApp) client() *http.Client {
	jar, _ := cookiejar.New(nil)
	return &http.Client{Jar: jar}
}

func (a *testApp) request(c *http.Client, method, path string, body any, status int) map[string]any {
	a.t.Helper()
	if path == "/learning" || path == "/learning/action" {
		return a.learningRequest(c, method, path, body, status)
	}
	data, _ := json.Marshal(body)
	req, _ := http.NewRequest(method, a.server.URL+"/api"+path, bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Zhiya-Request", "1")
	req.Header.Set("Origin", a.server.URL)
	res, err := c.Do(req)
	if err != nil {
		a.t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode != status {
		a.t.Fatalf("%s %s = %d %s; want %d", method, path, res.StatusCode, raw, status)
	}
	var result map[string]any
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &result); err != nil {
			a.t.Fatalf("invalid JSON: %s", raw)
		}
	}
	return result
}

const testPassword = "A-long-test-password-123"

func TestDuplicateRegistrationOffersAccountRecovery(t *testing.T) {
	a := setupAccountTest(t)
	a.register("registered@example.com")
	delete(a.mail, "registered@example.com:register")
	result := a.request(a.client(), "POST", "/auth/register/start", map[string]string{"email": " Registered@Example.com "}, 409)
	if result["error"] != "该邮箱已注册，请登录或找回密码" {
		t.Fatalf("unexpected duplicate registration response: %v", result)
	}
	if _, ok := result["flow"]; ok {
		t.Fatal("duplicate registration must not return a verification flow")
	}
	if _, sent := a.mail["registered@example.com:register"]; sent {
		t.Fatal("duplicate registration must not send a registration code")
	}
	a.request(a.client(), "POST", "/auth/login", map[string]string{"email": "registered@example.com", "password": testPassword}, 200)
}

func (a *testApp) register(email string) *http.Client {
	a.t.Helper()
	c := a.client()
	flow := a.request(c, "POST", "/auth/register/start", map[string]string{"email": email}, 200)["flow"].(string)
	a.request(c, "POST", "/auth/register/complete", map[string]string{"flow": flow, "code": a.mail[email+":register"], "password": testPassword}, 200)
	a.request(c, "POST", "/auth/login", map[string]string{"email": email, "password": testPassword}, 200)
	return c
}

func TestVerifiedRegistrationAndLogin(t *testing.T) {
	a := setupAccountTest(t)
	c := a.client()
	a.request(c, "GET", "/me", nil, 401)
	flow := a.request(c, "POST", "/auth/register/start", map[string]string{"email": "learner@example.com"}, 200)["flow"].(string)
	a.request(c, "POST", "/auth/login", map[string]string{"email": "learner@example.com", "password": testPassword}, 401)
	a.request(c, "POST", "/auth/register/complete", map[string]string{"flow": flow, "code": "wrong", "password": testPassword}, 400)
	code := a.mail["learner@example.com:register"]
	a.request(c, "POST", "/auth/register/complete", map[string]string{"flow": flow, "code": code, "password": testPassword}, 200)
	a.request(c, "POST", "/auth/register/complete", map[string]string{"flow": flow, "code": code, "password": testPassword}, 400)
	a.request(c, "POST", "/auth/login", map[string]string{"email": "learner@example.com", "password": testPassword}, 200)
	me := a.request(c, "GET", "/me", nil, 200)
	if me["email"] != "learner@example.com" || me["nickname"] != "学习者" {
		t.Fatal(fmt.Sprint(me))
	}
}

func TestPasswordRecoveryAndSessionRevocation(t *testing.T) {
	a := setupAccountTest(t)
	c := a.register("recovery@example.com")
	other := a.client()
	a.request(other, "POST", "/auth/login", map[string]string{"email": "recovery@example.com", "password": testPassword}, 200)
	a.request(c, "POST", "/auth/logout", map[string]string{}, 200)
	a.request(c, "GET", "/me", nil, 401)
	a.request(other, "GET", "/me", nil, 200)
	a.request(other, "POST", "/auth/logout-all", map[string]string{}, 200)
	a.request(other, "GET", "/me", nil, 401)
	a.request(c, "POST", "/auth/login", map[string]string{"email": "recovery@example.com", "password": testPassword}, 200)
	a.request(other, "POST", "/auth/login", map[string]string{"email": "recovery@example.com", "password": testPassword}, 200)
	a.request(c, "PUT", "/me/password", map[string]string{"currentPassword": "incorrect", "password": "a-new-long-password-123"}, 400)
	a.request(c, "PUT", "/me/password", map[string]string{"currentPassword": testPassword, "password": "a-new-long-password-123"}, 200)
	a.request(c, "GET", "/me", nil, 401)
	a.request(other, "GET", "/me", nil, 401)
	a.request(c, "POST", "/auth/login", map[string]string{"email": "recovery@example.com", "password": testPassword}, 401)
	a.request(c, "POST", "/auth/login", map[string]string{"email": "recovery@example.com", "password": "a-new-long-password-123"}, 200)
	flow := a.request(other, "POST", "/auth/reset/start", map[string]string{"email": "recovery@example.com"}, 200)["flow"].(string)
	a.request(other, "POST", "/auth/reset/complete", map[string]string{"flow": flow, "code": a.mail["recovery@example.com:reset"], "password": "a-recovered-password-123"}, 200)
	a.request(c, "GET", "/me", nil, 401)
	a.request(other, "POST", "/auth/login", map[string]string{"email": "recovery@example.com", "password": "a-recovered-password-123"}, 200)
}

func TestProfileAvatarAndDataIsolation(t *testing.T) {
	a := setupAccountTest(t)
	c := a.register("profile@example.com")
	other := a.register("other@example.com")
	a.request(c, "PATCH", "/me", map[string]string{"nickname": "小芽", "id": "someone-else"}, 400)
	a.request(c, "PATCH", "/me", map[string]string{"nickname": "小芽"}, 200)
	me := a.request(c, "GET", "/me", nil, 200)
	if me["nickname"] != "小芽" {
		t.Fatal(me)
	}
	if a.request(other, "GET", "/me", nil, 200)["nickname"] != "学习者" {
		t.Fatal("another account was modified")
	}
	a.request(c, "PUT", "/me/avatar", map[string]string{"avatar": "data:image/svg+xml;base64,PHN2Zy8+"}, 400)
	var imageData bytes.Buffer
	_ = png.Encode(&imageData, image.NewNRGBA(image.Rect(0, 0, 2, 2)))
	avatar := "data:image/png;base64," + base64.StdEncoding.EncodeToString(imageData.Bytes())
	a.request(c, "PUT", "/me/avatar", map[string]string{"avatar": avatar}, 200)
	if a.request(c, "GET", "/me", nil, 200)["avatar"] == "" {
		t.Fatal("avatar not saved")
	}
	if a.request(other, "GET", "/me", nil, 200)["avatar"] != "" {
		t.Fatal("avatar leaked")
	}
	a.request(c, "PUT", "/me/avatar", map[string]string{"avatar": ""}, 200)
	if a.request(c, "GET", "/me", nil, 200)["avatar"] != "" {
		t.Fatal("avatar not restored")
	}
}

func TestEmailChangeAndAccountDeletion(t *testing.T) {
	a := setupAccountTest(t)
	c := a.register("old@example.com")
	other := a.client()
	a.request(other, "POST", "/auth/login", map[string]string{"email": "old@example.com", "password": testPassword}, 200)
	before := a.request(c, "GET", "/me", nil, 200)
	a.request(c, "PATCH", "/me", map[string]string{"nickname": "保留昵称"}, 200)
	flow := a.request(c, "POST", "/me/email/start", map[string]string{"email": "new@example.com"}, 200)["flow"].(string)
	oldCode, newCode := a.mail["old@example.com:email"], a.mail["new@example.com:email-new"]
	a.request(c, "POST", "/me/email/complete", map[string]string{"flow": flow, "code": oldCode, "newCode": "wrong"}, 400)
	if a.request(c, "GET", "/me", nil, 200)["email"] != "old@example.com" {
		t.Fatal("unverified email changed")
	}
	a.request(c, "POST", "/me/email/complete", map[string]string{"flow": flow, "code": oldCode, "newCode": newCode}, 200)
	after := a.request(c, "GET", "/me", nil, 200)
	if after["id"] != before["id"] || after["nickname"] != "保留昵称" || after["email"] != "new@example.com" {
		t.Fatal(after)
	}
	a.request(a.client(), "POST", "/auth/login", map[string]string{"email": "old@example.com", "password": testPassword}, 401)
	a.request(a.client(), "POST", "/auth/login", map[string]string{"email": "new@example.com", "password": testPassword}, 200)
	a.request(c, "DELETE", "/me", map[string]any{"currentPassword": testPassword, "confirm": false}, 400)
	a.request(c, "DELETE", "/me", map[string]any{"currentPassword": "wrong", "confirm": true}, 400)
	a.request(c, "DELETE", "/me", map[string]any{"currentPassword": testPassword, "confirm": true}, 200)
	a.request(c, "GET", "/me", nil, 401)
	a.request(other, "GET", "/me", nil, 401)
	a.request(a.client(), "POST", "/auth/login", map[string]string{"email": "new@example.com", "password": testPassword}, 401)
	fresh := a.register("new@example.com")
	if a.request(fresh, "GET", "/me", nil, 200)["id"] == before["id"] {
		t.Fatal("deleted identity was restored")
	}
}

func TestVerificationAttemptsAndPurposeAreEnforced(t *testing.T) {
	a := setupAccountTest(t)
	c := a.client()
	flow := a.request(c, "POST", "/auth/register/start", map[string]string{"email": "attempts@example.com"}, 200)["flow"].(string)
	code := a.mail["attempts@example.com:register"]
	for i := 0; i < 5; i++ {
		a.request(c, "POST", "/auth/register/complete", map[string]string{"flow": flow, "code": "wrong", "password": testPassword}, 400)
	}
	a.request(c, "POST", "/auth/register/complete", map[string]string{"flow": flow, "code": code, "password": testPassword}, 400)
	c = a.register("owner@example.com")
	other := a.register("outsider@example.com")
	flow = a.request(c, "POST", "/me/email/start", map[string]string{"email": "replacement@example.com"}, 200)["flow"].(string)
	codes := map[string]string{"flow": flow, "code": a.mail["owner@example.com:email"], "newCode": a.mail["replacement@example.com:email-new"]}
	a.request(other, "POST", "/me/email/complete", codes, 400)
	a.request(c, "POST", "/auth/register/complete", map[string]string{"flow": flow, "code": codes["code"], "password": testPassword}, 400)
	a.request(c, "POST", "/me/email/complete", codes, 200)
}

func TestCrossSiteRequestsCannotModifyAccount(t *testing.T) {
	a := setupAccountTest(t)
	c := a.register("csrf@example.com")
	for _, origin := range []string{"https://evil.example", a.server.URL} {
		req, _ := http.NewRequest("PATCH", a.server.URL+"/api/me", strings.NewReader(`{"nickname":"attacker"}`))
		req.Header.Set("Origin", origin)
		req.Header.Set("Content-Type", "application/json")
		if origin != a.server.URL {
			req.Header.Set("X-Zhiya-Request", "1")
		}
		response, err := c.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != 403 {
			t.Fatalf("cross-site/missing-header request = %d", response.StatusCode)
		}
	}
	if a.request(c, "GET", "/me", nil, 200)["nickname"] != "学习者" {
		t.Fatal("cross-site modification succeeded")
	}
}

func TestStalePageCannotModifyAnotherSignedInAccount(t *testing.T) {
	a := setupAccountTest(t)
	c := a.register("stale@example.com")
	oldID := a.request(c, "GET", "/me", nil, 200)["id"].(string)
	other := a.register("active@example.com")
	req, _ := http.NewRequest("PATCH", a.server.URL+"/api/me", strings.NewReader(`{"nickname":"stale edit"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Zhiya-Request", "1")
	req.Header.Set("X-Zhiya-User", oldID)
	response, err := other.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 401 {
		t.Fatalf("stale page update = %d; want 401", response.StatusCode)
	}
	if a.request(other, "GET", "/me", nil, 200)["nickname"] != "学习者" {
		t.Fatal("stale page modified another account")
	}
}

func TestRegistrationCodeCanOnlyBeConsumedOnceConcurrently(t *testing.T) {
	a := setupAccountTest(t)
	c := a.client()
	flow := a.request(c, "POST", "/auth/register/start", map[string]string{"email": "concurrent@example.com"}, 200)["flow"].(string)
	payload, _ := json.Marshal(map[string]string{"flow": flow, "code": a.mail["concurrent@example.com:register"], "password": testPassword})
	results := make(chan int, 2)
	for i := 0; i < 2; i++ {
		go func() {
			req, _ := http.NewRequest("POST", a.server.URL+"/api/auth/register/complete", bytes.NewReader(payload))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-Zhiya-Request", "1")
			response, err := c.Do(req)
			if err != nil {
				results <- 0
				return
			}
			response.Body.Close()
			results <- response.StatusCode
		}()
	}
	first, second := <-results, <-results
	if !((first == 200 && second == 400) || (first == 400 && second == 200)) {
		t.Fatalf("concurrent completions = %d, %d", first, second)
	}
}

func TestHealth(t *testing.T) {
	response := httptest.NewRecorder()
	(&application{}).routes().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/health", nil))
	if response.Code != http.StatusOK || response.Body.String() != "ok\n" {
		t.Fatalf("GET /health = %d %q; want 200 and ok", response.Code, response.Body.String())
	}
}

func TestConfiguredRateLimitAndRetryAfter(t *testing.T) {
	t.Setenv("ZHIYA_SERVER_ACCOUNT_IP_LIMIT", "1")
	t.Setenv("ZHIYA_SERVER_ACCOUNT_RATE_WINDOW_SECONDS", "7")
	a := setupAccountTest(t)
	c := a.client()
	a.request(c, "POST", "/auth/register/start", map[string]string{"email": "limit@example.com"}, 200)
	req, _ := http.NewRequest("POST", a.server.URL+"/api/auth/register/start", strings.NewReader(`{"email":"second@example.com"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Zhiya-Request", "1")
	response, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 429 || response.Header.Get("Retry-After") != "7" {
		t.Fatalf("configured limit = %d, Retry-After %q; want 429 and 7", response.StatusCode, response.Header.Get("Retry-After"))
	}
}

func TestConfiguredSessionExpiresEvenWhenCookieIsReplayed(t *testing.T) {
	t.Setenv("ZHIYA_SERVER_ACCOUNT_SESSION_TTL_SECONDS", "1")
	a := setupAccountTest(t)
	a.register("session-expiry@example.com")
	req, _ := http.NewRequest("POST", a.server.URL+"/api/auth/login", strings.NewReader(`{"email":"session-expiry@example.com","password":"`+testPassword+`"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Zhiya-Request", "1")
	c := a.client()
	response, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	cookies := response.Cookies()
	if response.StatusCode != 200 || len(cookies) != 1 || cookies[0].MaxAge != 1 {
		t.Fatal("session cookie did not use configured lifetime")
	}
	fresh, _ := http.NewRequest("GET", a.server.URL+"/api/me", nil)
	fresh.AddCookie(cookies[0])
	response, err = (&http.Client{}).Do(fresh)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatalf("new session already expired: %d", response.StatusCode)
	}
	time.Sleep(1100 * time.Millisecond)
	replay, _ := http.NewRequest("GET", a.server.URL+"/api/me", nil)
	replay.AddCookie(cookies[0])
	response, err = (&http.Client{}).Do(replay)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 401 {
		t.Fatalf("expired session replay = %d; want 401", response.StatusCode)
	}
}

func TestDeploymentConfigurationIsNotExposed(t *testing.T) {
	response := httptest.NewRecorder()
	(&application{}).routes().ServeHTTP(response, httptest.NewRequest("GET", "/api/config", nil))
	if response.Code != http.StatusNotFound {
		t.Fatalf("GET /api/config = %d; want 404", response.Code)
	}
}

func TestPublicAccountRulesMatchServerValidation(t *testing.T) {
	a := setupAccountTest(t)
	c := a.client()
	rules := a.request(c, "GET", "/account-rules", nil, 200)
	if len(rules) != 7 {
		t.Fatal("unexpected fields in public account rules")
	}
	for _, field := range []string{"password_min_characters", "password_max_bytes", "nickname_max_characters", "avatar_max_bytes", "avatar_max_dimension", "verification_code_digits", "verification_ttl_seconds"} {
		if _, ok := rules[field].(float64); !ok {
			t.Fatalf("missing public rule %s", field)
		}
	}
	minPassword := int(rules["password_min_characters"].(float64))
	if minPassword != 8 {
		t.Fatalf("minimum password length = %d; want 8", minPassword)
	}
	flow := a.request(c, "POST", "/auth/register/start", map[string]string{"email": "rules@example.com"}, 200)["flow"].(string)
	code := a.mail["rules@example.com:register"]
	if len(code) != int(rules["verification_code_digits"].(float64)) {
		t.Fatal("code length disagrees with public rules")
	}
	short := a.request(c, "POST", "/auth/register/complete", map[string]string{"flow": flow, "code": code, "password": "1234567"}, 400)
	if short["error"] != "密码至少需要 8 个字符" {
		t.Fatalf("unexpected short password message: %v", short)
	}
	long := a.request(c, "POST", "/auth/register/complete", map[string]string{"flow": flow, "code": code, "password": strings.Repeat("芽", 86)}, 400)
	if long["error"] != "密码太长，请缩短后重试" {
		t.Fatalf("unexpected long password message: %v", long)
	}
	password := strings.Repeat("a", minPassword)
	a.request(c, "POST", "/auth/register/complete", map[string]string{"flow": flow, "code": code, "password": password}, 200)
	a.request(c, "POST", "/auth/login", map[string]string{"email": "rules@example.com", "password": password}, 200)
	maxNickname := int(rules["nickname_max_characters"].(float64))
	a.request(c, "PATCH", "/me", map[string]string{"nickname": strings.Repeat("芽", maxNickname+1)}, 400)
	a.request(c, "PATCH", "/me", map[string]string{"nickname": strings.Repeat("芽", maxNickname)}, 200)
}

package client

import (
	"context"
	"net/http"
	"net/url"
	"strings"
)

// Business/model tests act as the service host, with a grant for the test user.
// Client boundary tests use the public server directly.
func (a *testApp) workerHeaders(c *http.Client, kind string) http.Header {
	a.t.Helper()
	origin, _ := url.Parse(a.server.URL)
	token := ""
	for _, cookie := range c.Jar.Cookies(origin) {
		if cookie.Name == "zhiya_session" {
			token = cookie.Value
		}
	}
	session, err := a.app.executionService().Open(context.Background(), token, "", kind, "", "")
	if err != nil {
		a.t.Fatal(err)
	}
	session, err = a.app.executionService().Claim(context.Background(), session.UserID, session.ID)
	if err != nil {
		a.t.Fatal(err)
	}
	return http.Header{"Authorization": []string{"Bearer " + a.config.Agent.Secret}, "X-Zhiya-Agent-Session": []string{session.ID}, "X-Zhiya-Execution": []string{session.Grant}}
}
func (a *testApp) workerDo(c *http.Client, r *http.Request) (*http.Response, error) {
	if r.URL.Path != "/api/learning/model" && r.URL.Path != "/api/learning/course/model" {
		return c.Do(r)
	}
	kind := "profile"
	path := "/learning/model"
	if strings.Contains(r.URL.Path, "/course/") {
		kind = "course"
		path = "/course/model"
	}
	request := r.Clone(r.Context())
	request.URL, _ = url.Parse(a.internal.URL + path)
	for key, value := range a.workerHeaders(c, kind) {
		request.Header[key] = value
	}
	return c.Do(request)
}

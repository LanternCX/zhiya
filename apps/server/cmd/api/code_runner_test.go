package main

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/LanternCX/zhiya/apps/server/internal/config"
)

func TestCodeLanguagesReturnsTheConfiguredRuntimeLanguages(t *testing.T) {
	a := &application{runner: newCodeRunnerClient(config.Runner{}, http.DefaultClient, slog.Default())}
	response := httptest.NewRecorder()
	a.codeLanguages(response, httptest.NewRequest(http.MethodGet, "/api/code/languages", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	var result struct {
		Languages []codeLanguage `json:"languages"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Languages) != 8 || result.Languages[0].Name != "Python" || result.Languages[7].Name != "Rust" {
		t.Fatalf("unexpected languages: %#v", result.Languages)
	}
}

func TestRunCodeReturnsProgramOutput(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/run" {
			t.Fatalf("unexpected runner request: %s %s", r.Method, r.URL.String())
		}
		var input struct {
			Cmd []struct {
				Args  []string `json:"args"`
				Files []struct {
					Content string `json:"content"`
				} `json:"files"`
				CopyIn map[string]struct {
					Content string `json:"content"`
				} `json:"copyIn"`
			} `json:"cmd"`
		}
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			t.Fatal(err)
		}
		if len(input.Cmd) != 1 || input.Cmd[0].Args[0] != "/usr/bin/python3" || input.Cmd[0].CopyIn["source.py"].Content != "print(input())" || input.Cmd[0].Files[0].Content != "你好\n" {
			t.Fatalf("unexpected execution: %#v", input)
		}
		writeJSON(w, http.StatusOK, []map[string]any{{
			"status": "Accepted", "exitStatus": 0, "time": 10_000_000, "memory": 3200,
			"files": map[string]string{"stdout": "你好\n", "stderr": ""},
		}})
	}))
	defer upstream.Close()

	a := &application{
		config: config.Config{Server: config.Server{MaxBodyBytes: 1024}},
		runner: newCodeRunnerClient(config.Runner{Endpoint: upstream.URL}, upstream.Client(), slog.Default()),
	}
	body, _ := json.Marshal(map[string]any{"languageId": 1, "sourceCode": "print(input())", "stdin": "你好\n"})
	response := httptest.NewRecorder()
	a.runCode(response, httptest.NewRequest(http.MethodPost, "/api/code/runs", bytes.NewReader(body)))

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	var result codeRunResult
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Stdout != "你好\n" || result.Status.Description != "Completed" || result.Time != "0.01" || result.Memory != 3200 {
		t.Fatalf("unexpected run result: %#v", result)
	}
}

func TestRunCodeCompilesExecutesAndCleansCachedArtifact(t *testing.T) {
	requests := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		switch requests {
		case 1:
			if r.Method != http.MethodPost || r.URL.Path != "/run" {
				t.Fatalf("unexpected compile request: %s %s", r.Method, r.URL.String())
			}
			var input map[string]any
			if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
				t.Fatal(err)
			}
			command := input["cmd"].([]any)[0].(map[string]any)
			args := command["args"].([]any)
			copyIn := command["copyIn"].(map[string]any)
			if args[0] != "/usr/bin/gcc" || copyIn["source.c"].(map[string]any)["content"] != "int main(void) { return 0; }" {
				t.Fatalf("unexpected compile command: %#v", command)
			}
			writeJSON(w, http.StatusOK, []map[string]any{{
				"status":  "Accepted",
				"files":   map[string]string{"stdout": "", "stderr": "warning\n"},
				"fileIds": map[string]string{"program": "compiled-program"},
			}})
		case 2:
			if r.Method != http.MethodPost || r.URL.Path != "/run" {
				t.Fatalf("unexpected run request: %s %s", r.Method, r.URL.String())
			}
			var input map[string]any
			if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
				t.Fatal(err)
			}
			command := input["cmd"].([]any)[0].(map[string]any)
			copyIn := command["copyIn"].(map[string]any)
			if copyIn["program"].(map[string]any)["fileId"] != "compiled-program" {
				t.Fatalf("compiled artifact was not executed: %#v", command)
			}
			writeJSON(w, http.StatusOK, []map[string]any{{
				"status": "Accepted", "time": 1_000_000, "memory": 4096,
				"files": map[string]string{"stdout": "done\n", "stderr": ""},
			}})
		case 3:
			if r.Method != http.MethodDelete || r.URL.Path != "/file/compiled-program" {
				t.Fatalf("compiled artifact was not cleaned: %s %s", r.Method, r.URL.String())
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			t.Fatalf("unexpected extra request: %s %s", r.Method, r.URL.String())
		}
	}))
	defer upstream.Close()

	a := &application{
		config: config.Config{Server: config.Server{MaxBodyBytes: 1024}},
		runner: newCodeRunnerClient(config.Runner{Endpoint: upstream.URL}, upstream.Client(), slog.Default()),
	}
	body := bytes.NewBufferString(`{"languageId":4,"sourceCode":"int main(void) { return 0; }","stdin":""}`)
	response := httptest.NewRecorder()
	a.runCode(response, httptest.NewRequest(http.MethodPost, "/api/code/runs", body))

	if response.Code != http.StatusOK || requests != 3 {
		t.Fatalf("expected compile, run, and cleanup, got %d requests and %s", requests, response.Body.String())
	}
	var result codeRunResult
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Stdout != "done\n" || result.CompileOutput != "warning\n" || result.Status.Description != "Completed" {
		t.Fatalf("unexpected compiled run result: %#v", result)
	}
}

func TestRunCodeCleansPartialArtifactAfterCompilationError(t *testing.T) {
	requests := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		switch requests {
		case 1:
			writeJSON(w, http.StatusOK, []map[string]any{{
				"status":  "Nonzero Exit Status",
				"files":   map[string]string{"stdout": "", "stderr": "compile failed\n"},
				"fileIds": map[string]string{"source.js": "partial-artifact"},
			}})
		case 2:
			if r.Method != http.MethodDelete || r.URL.Path != "/file/partial-artifact" {
				t.Fatalf("partial artifact was not cleaned: %s %s", r.Method, r.URL.String())
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			t.Fatalf("unexpected extra request: %s %s", r.Method, r.URL.String())
		}
	}))
	defer upstream.Close()

	a := &application{
		config: config.Config{Server: config.Server{MaxBodyBytes: 1024}},
		runner: newCodeRunnerClient(config.Runner{Endpoint: upstream.URL}, upstream.Client(), slog.Default()),
	}
	body := bytes.NewBufferString(`{"languageId":3,"sourceCode":"const value: string = missing;","stdin":""}`)
	response := httptest.NewRecorder()
	a.runCode(response, httptest.NewRequest(http.MethodPost, "/api/code/runs", body))

	if response.Code != http.StatusOK || requests != 2 {
		t.Fatalf("expected compile and cleanup, got %d requests and %s", requests, response.Body.String())
	}
	var result codeRunResult
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.CompileOutput != "compile failed\n" || result.Status.Description != "Compilation Error" {
		t.Fatalf("unexpected compilation result: %#v", result)
	}
}

func TestRunCodeRejectsUnknownLanguagesAndEmptyPrograms(t *testing.T) {
	a := &application{
		config: config.Config{Server: config.Server{MaxBodyBytes: 1024}},
		runner: newCodeRunnerClient(config.Runner{}, http.DefaultClient, slog.Default()),
	}
	for _, body := range []string{
		`{"languageId":99,"sourceCode":"print(1)","stdin":""}`,
		`{"languageId":1,"sourceCode":"","stdin":""}`,
	} {
		response := httptest.NewRecorder()
		a.runCode(response, httptest.NewRequest(http.MethodPost, "/api/code/runs", bytes.NewBufferString(body)))
		if response.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d: %s", response.Code, response.Body.String())
		}
	}
}

func TestRunCodeWarnsWhenCompiledArtifactCleanupFails(t *testing.T) {
	requests := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		switch requests {
		case 1:
			writeJSON(w, http.StatusOK, []map[string]any{{
				"status": "Accepted", "files": map[string]string{"stdout": "", "stderr": ""}, "fileIds": map[string]string{"program": "compiled-program"},
			}})
		case 2:
			writeJSON(w, http.StatusOK, []map[string]any{{
				"status": "Accepted", "files": map[string]string{"stdout": "done", "stderr": ""},
			}})
		case 3:
			http.Error(w, "cleanup unavailable", http.StatusServiceUnavailable)
		default:
			t.Fatalf("unexpected extra request: %s %s", r.Method, r.URL.String())
		}
	}))
	defer upstream.Close()

	var output bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&output, nil))
	runner := newCodeRunnerClient(config.Runner{Endpoint: upstream.URL}, upstream.Client(), logger)
	result, err := runner.Run(context.Background(), 4, "int main(void) { return 0; }", "")
	if err != nil || result.Stdout != "done" {
		t.Fatalf("run result = %#v, %v", result, err)
	}
	records := decodeApplicationLogs(t, output.String())
	if len(records) != 1 || records[0]["msg"] != "code runner artifact cleanup failed" || records[0]["artifact_id"] != "compiled-program" {
		t.Fatalf("cleanup failure was not logged: %v", records)
	}
}

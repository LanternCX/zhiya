package main

import (
	"net/http"
	"strings"

	"github.com/LanternCX/zhiya/apps/server/internal/coderunner"
)

type codeRunner = coderunner.Runner
type codeLanguage = coderunner.Language
type codeRunResult = coderunner.Result

var newCodeRunnerClient = coderunner.New

func (a *application) codeLanguages(w http.ResponseWriter, r *http.Request) {
	languages, err := a.runner.Languages(r.Context())
	if err != nil {
		a.respondError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"languages": languages})
}

func (a *application) runCode(w http.ResponseWriter, r *http.Request) {
	var input struct {
		LanguageID int    `json:"languageId"`
		SourceCode string `json:"sourceCode"`
		Stdin      string `json:"stdin"`
	}
	if err := a.readJSON(w, r, &input); err != nil {
		a.respondError(w, err)
		return
	}
	if !coderunner.Supports(input.LanguageID) || strings.TrimSpace(input.SourceCode) == "" {
		a.respondError(w, bad("请选择语言并输入代码"))
		return
	}
	result, err := a.runner.Run(r.Context(), input.LanguageID, input.SourceCode, input.Stdin)
	if err != nil {
		a.respondError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

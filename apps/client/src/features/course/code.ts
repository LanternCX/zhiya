import { api } from "../../api";
import type { CodeLanguage, CodeRunResult } from "../../domain/learning";

export async function listCodeLanguages() {
  return (await api<{ languages: CodeLanguage[] }>("/code/languages"))
    .languages;
}

function comparableLanguageName(name: string) {
  return name.trim().toLowerCase().replace(/\s*\([^)]*\)\s*$/, "");
}

export function resolveCodeLanguageId(
  languageId: number,
  languageName: string,
  languages: CodeLanguage[],
) {
  const requestedName = comparableLanguageName(languageName);
  const direct = languages.find(({ id }) => id === languageId);
  if (direct && comparableLanguageName(direct.name) === requestedName) {
    return direct.id;
  }

  const compatible = languages.find(
    ({ name }) => comparableLanguageName(name) === requestedName,
  );
  if (compatible) return compatible.id;
  throw new Error("暂不支持该编程语言");
}

export async function runCode(
  languageId: number,
  languageName: string,
  sourceCode: string,
  stdin: string,
) {
  const languages = await listCodeLanguages();
  const resolvedLanguageId = resolveCodeLanguageId(
    languageId,
    languageName,
    languages,
  );
  return api<CodeRunResult>("/code/runs", "POST", {
    languageId: resolvedLanguageId,
    sourceCode,
    stdin,
  });
}

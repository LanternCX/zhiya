import { usePolicy } from "./Policy";
import { useId, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";

export function Field({
  label,
  name,
  type = "text",
  autoComplete,
  maxLength,
  value,
  onChange,
  validate,
  hint,
  inputMode,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  maxLength?: number;
  value?: string;
  onChange?: (value: string) => void;
  validate?: (value: string) => string;
  hint?: string;
  inputMode?: "email" | "numeric";
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [touched, setTouched] = useState(false);
  const text = value ?? draft;
  const normalized = type === "email" ? text.trim() : text;
  const message = !normalized
    ? `请输入${label}`
    : type === "email" &&
        (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))
      ? "请输入有效的邮箱地址，例如 name@example.com"
      : validate?.(normalized) ?? "";
  useLayoutEffect(() => {
    input.current?.setCustomValidity(message);
  }, [message]);
  const error = touched ? message : "";
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        ref={input}
        name={name}
        type={type === "email" ? "text" : type}
        data-email={type === "email" ? true : undefined}
        autoComplete={autoComplete}
        maxLength={maxLength}
        value={text}
        onChange={(event) => {
          setDraft(event.target.value);
          onChange?.(event.target.value);
        }}
        onBlur={() => {
          setTouched(true);
          if (type === "email") {
            setDraft(normalized);
            onChange?.(normalized);
          }
        }}
        onInvalid={(event) => {
          event.preventDefault();
          setTouched(true);
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-help` : undefined}
        inputMode={inputMode ?? (type === "email" ? "email" : undefined)}
        autoCapitalize="none"
        required
        spellCheck={false}
      />
      <p
        id={`${id}-help`}
        className={error ? "field-error" : "field-hint"}
        aria-live="polite"
      >
        {error || hint}
      </p>
    </div>
  );
}

export function Password({
  current = false,
  label,
  name,
  value,
  onChange,
  validate,
  success,
}: {
  current?: boolean;
  label?: string;
  name?: string;
  value?: string;
  onChange?: (value: string) => void;
  validate?: (value: string) => string;
  success?: string;
}) {
  const rules = usePolicy();
  const [visible, setVisible] = useState(false);
  const fieldLabel = label ?? (current ? "当前密码" : "密码");
  const toggleLabel = `${visible ? "隐藏" : "显示"}${fieldLabel}`;
  return (
    <div className={`password-field${success ? " has-success" : ""}`}>
      <Field
        label={fieldLabel}
        name={name ?? (current ? "currentPassword" : "password")}
        type={visible ? "text" : "password"}
        autoComplete={current ? "current-password" : "new-password"}
        value={value}
        onChange={onChange}
        validate={validate ?? (text =>
          new TextEncoder().encode(text).length > rules.password_max_bytes
            ? "密码太长，请缩短后重试" : ""
        )}
      />
      {success && (
        <svg className="password-success" viewBox="0 0 24 24" role="img" aria-label={success}>
          <path d="m5 12 4 4L19 6" />
        </svg>
      )}
      <button
        className="password-toggle"
        type="button"
        aria-pressed={visible}
        aria-label={toggleLabel}
        title={toggleLabel}
        onClick={() => setVisible(!visible)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          {visible ? (
            <path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.5 5.3A10.5 10.5 0 0 1 12 5c6 0 10 7 10 7a18 18 0 0 1-3.1 3.8M6.2 6.2A20 20 0 0 0 2 12s4 7 10 7a11 11 0 0 0 5.8-1.8" />
          ) : (
            <>
              <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
              <circle cx="12" cy="12" r="3" />
            </>
          )}
        </svg>
      </button>
    </div>
  );
}

export function NewPasswordFields() {
  const rules = usePolicy();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const longEnough = Array.from(password).length >= rules.password_min_characters;
  const withinLimit = new TextEncoder().encode(password).length <= rules.password_max_bytes;
  const requirements = [
    { text: `至少 ${rules.password_min_characters} 个字符`, met: longEnough },
    { text: "长度未超出上限", met: !!password && withinLimit },
  ];
  return (
    <>
      <Password
        value={password}
        onChange={setPassword}
        validate={() => !longEnough
          ? `密码至少需要 ${rules.password_min_characters} 个字符`
          : !withinLimit ? "密码太长，请缩短后重试" : ""
        }
      />
      <ul className="password-rules" aria-label="密码要求" aria-live="polite">
        {requirements.map(({ text, met }) => (
          <li key={text} data-met={met}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {met ? <path d="m5 12 4 4L19 6" /> : <circle cx="12" cy="12" r="7" />}
            </svg>
            <span className="visually-hidden">{met ? "已满足：" : "未满足："}</span>
            <span>{text}</span>
          </li>
        ))}
      </ul>
      <Password
        label="确认密码"
        name="confirmPassword"
        value={confirmation}
        onChange={setConfirmation}
        success={confirmation && confirmation === password ? "两次输入一致" : undefined}
        validate={text => text !== password ? "两次输入的密码不一致" : ""}
      />
    </>
  );
}

export function CodeField({ label = "验证码", name = "code" }: {
  label?: string;
  name?: string;
}) {
  const rules = usePolicy();
  return (
    <Field
      label={label}
      name={name}
      autoComplete="one-time-code"
      inputMode="numeric"
      hint={`${rules.verification_code_digits} 位数字`}
      validate={text => new RegExp(`^[0-9]{${rules.verification_code_digits}}$`).test(text)
        ? "" : `请输入 ${rules.verification_code_digits} 位数字验证码`
      }
    />
  );
}

export function Form({
  children,
  submit,
  busy,
}: {
  children: ReactNode;
  submit: (data: FormData) => Promise<void>;
  busy: boolean;
}) {
  return (
    <form
      noValidate
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (busy) return;
        const form = event.currentTarget;
        if (!form.checkValidity()) {
          form.querySelector<HTMLInputElement>("input:invalid")?.focus();
          return;
        }
        const data = new FormData(form);
        for (const input of form.querySelectorAll<HTMLInputElement>("input[data-email]")) {
          data.set(input.name, input.value.trim().toLowerCase());
        }
        void submit(data);
      }}
    >
      <fieldset disabled={busy}>{children}</fieldset>
    </form>
  );
}

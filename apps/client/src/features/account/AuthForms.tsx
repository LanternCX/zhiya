import { api } from "../../api";
import { useState } from "react";
import Icon from "../../components/Icon";
import "./identity.css";
import { CodeField, Field, Form, NewPasswordFields, Password } from "./Form";
import type { AccountController } from "./useAccount";
import { useVerification, VerificationActions, VerificationHelp } from "./Verification";

type Props = Pick<
  AccountController,
  | "view"
  | "flow"
  | "busy"
  | "email"
  | "setEmail"
  | "navigate"
  | "sendCode"
  | "run"
  | "setView"
  | "setFlow"
  | "setNotice"
  | "login"
>;

export default function AuthForms({
  view,
  flow,
  busy,
  email,
  setEmail,
  navigate,
  sendCode,
  run,
  setView,
  setFlow,
  setNotice,
  login,
}: Props) {
  const verification = useVerification(flow);
  const [role, setRole] = useState<"teacher" | "student" | "">("");
  const identity = (
    <fieldset className="identity-choice">
      <legend>你是老师还是学生？</legend>
      <div className="identity-options">
        {(["student", "teacher"] as const).map(value => (
          <label key={value} className={role === value ? "is-selected" : ""}>
            <input type="radio" name="role" value={value} checked={role === value} onChange={() => setRole(value)} required />
            <Icon name={value} />
            <span>{value === "teacher" ? "我是老师" : "我是学生"}<small>{value === "teacher" ? "备课教学 · 建立班级" : "探索知识 · 加入班级"}</small></span>
          </label>
        ))}
      </div>
    </fieldset>
  );
  return (
    <>
      {view === "login" && (
        <>
          <Form busy={busy} submit={login}>
            <Field
              label="邮箱"
              name="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={setEmail}
            />
            <Password current label="密码" name="password" />
            <button
              type="button"
              className="text-button forgot"
              onClick={() => navigate("reset")}
            >
              忘记密码
            </button>
            <button className="primary full">
              {busy ? "正在登录…" : "登录"}
            </button>
          </Form>
        </>
      )}
      {(view === "register" || view === "reset") && (
        <>
          <p className="description">
            {flow
              ? `验证码已发送至 ${flow.email}，请查收。`
              : view === "register"
                ? "验证邮箱后，即可创建账号。"
                : "通过注册邮箱验证身份，设置新密码。"}
          </p>
          {!flow ? (
            <Form
              busy={busy}
              submit={(data) => sendCode(view, String(data.get("email")), role || undefined)}
            >
              {view === "register" && identity}
              <Field
                label="邮箱"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={setEmail}
              />
              <button className="primary full">{busy ? "正在发送…" : "发送验证码"}</button>
            </Form>
          ) : (
            <Form
              busy={busy}
              submit={(data) =>
                run(async () => {
                  await api(`/auth/${view}/complete`, "POST", {
                    flow: flow.id,
                    code: data.get("code"),
                    password: data.get("password"),
                    ...(view === "register" ? { role: flow.role } : {}),
                  });
                  setView("login");
                  setEmail(flow.email);
                  setFlow(null);
                  setNotice(
                    view === "register"
                      ? "注册成功，请登录"
                      : "密码已重设，所有设备均已退出，请使用新密码登录",
                  );
                })
              }
            >
              {view === "register" && <p className="registration-identity"><Icon name={flow.role === "teacher" ? "teacher" : "student"} />{flow.role === "teacher" ? "老师账号" : "学生账号"}</p>}
              <CodeField key={flow.id} />
              <VerificationHelp {...verification} />
              <NewPasswordFields />
              {view === "reset" && <p className="hint">重设后所有设备都需要重新登录</p>}
              <button className="primary full" disabled={verification.expired}>
                {view === "register" ? "完成注册" : "重设密码"}
              </button>
              <VerificationActions cooldown={verification.cooldown} busy={busy}
                resend={() => sendCode(view, flow.email)} changeEmail={() => void navigate(view)} />
            </Form>
          )}
          <button
            className="text-button"
            disabled={busy}
            onClick={() => navigate("login")}
          >
            返回登录
          </button>
          {view === "register" && !flow && (
            <button
              className="text-button recovery-link"
              disabled={busy}
              onClick={() => navigate("reset")}
            >
              忘记密码
            </button>
          )}
        </>
      )}
    </>
  );
}

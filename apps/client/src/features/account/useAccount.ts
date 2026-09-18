import type { AccountPolicy } from "./Policy";
import { useEffect, useRef, useState } from "react";
import { api, APIError } from "../../api";
import { setActiveUser } from "../../transport/identity";
import type { User } from "../../api";
import type { Flow, View } from "./types";
import type { ConfirmationOptions } from "../../components/Confirmation";
import {
  useBeforeUnload,
  useBlocker,
  useLocation,
  useNavigate,
} from "react-router";
import { accountPaths, isAuthPage, usePage } from "../../routes";

export function useAccount() {
  const [policy, setPolicy] = useState<AccountPolicy | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const page = usePage();
  const location = useLocation();
  const routeNavigate = useNavigate();
  const internalNavigation = useRef(false);
  const feedbackDestination = useRef<string | null>(null);
  const view: View = Object.hasOwn(accountPaths, page)
    ? (page as View)
    : "home";
  function setView(next: View) {
    feedbackDestination.current = accountPaths[next];
    internalNavigation.current = true;
    void routeNavigate(accountPaths[next], { replace: true });
    internalNavigation.current = false;
  }
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [flow, setFlow] = useState<Flow | null>(null);
  const [email, setEmail] = useState("");
  const [nickname, setNickname] = useState("");
  const [avatarDraft, setAvatarDraft] = useState<string | null>(null);
  const epoch = useRef(0);
  const running = useRef(false);
  const channel = useRef<BroadcastChannel | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationOptions | null>(
    null,
  );
  const pendingConfirmation = useRef<((confirmed: boolean) => void) | null>(
    null,
  );
  const unsaved = Boolean(
    view === "profile" &&
      user &&
      (nickname !== user.nickname || avatarDraft !== null),
  );
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !internalNavigation.current &&
      !loading &&
      currentLocation.pathname !== nextLocation.pathname &&
      (busy || unsaved),
  );
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (pendingConfirmation.current) return;
    if (running.current) {
      blocker.reset();
      return;
    }
    const generation = epoch.current;
    void confirmAction({
      title: "放弃未保存的修改？",
      text: "资料尚未保存，离开后这些修改将丢失。",
      confirmLabel: "放弃修改",
    }).then((confirmed) => {
      if (confirmed && generation === epoch.current) blocker.proceed();
      else blocker.reset();
    });
  }, [blocker]);
  useBeforeUnload((event) => {
    if (!unsaved) return;
    event.preventDefault();
    event.returnValue = "";
  });
  useEffect(() => {
    setFlow(null);
    setAvatarDraft(null);
    if (user) setNickname(user.nickname);
    if (feedbackDestination.current !== location.pathname) {
      setError("");
      setNotice("");
    }
    feedbackDestination.current = null;
  }, [location.pathname]);
  function answerConfirmation(confirmed: boolean) {
    const resolve = pendingConfirmation.current;
    pendingConfirmation.current = null;
    setConfirmation(null);
    resolve?.(confirmed);
  }
  function confirmAction(options: ConfirmationOptions) {
    if (running.current || pendingConfirmation.current)
      return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      pendingConfirmation.current = resolve;
      setConfirmation(options);
    });
  }

  async function load(resetNavigation = false) {
    const generation = ++epoch.current;
    answerConfirmation(false);
    running.current = false;
    setActiveUser("");
    setUser(null);
    setAvatarDraft(null);
    setFlow(null);
    setLoading(true);
    setBusy(false);
    setOffline(false);
    setError("");
    let rulesLoaded = false;
    try {
      const rules = await api<AccountPolicy>("/account-rules");
      if (generation !== epoch.current) return;
      setPolicy(rules);
      rulesLoaded = true;
      const me = await api<User>("/me");
      if (generation !== epoch.current) return;
      setActiveUser(me.id);
      setUser(me);
      setNickname(me.nickname);
      if (resetNavigation) setView("home");
    } catch (err) {
      if (generation !== epoch.current) return;
      if (rulesLoaded && err instanceof APIError && err.status === 401) {
        setUser(null);
        if (resetNavigation) setView("login");
      } else {
        setOffline(true);
        setError(message(err));
      }
    } finally {
      if (generation === epoch.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      epoch.current++;
      pendingConfirmation.current?.(false);
      pendingConfirmation.current = null;
    };
  }, []);
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const current = new BroadcastChannel("zhiya-account");
    channel.current = current;
    current.onmessage = () => {
      setNotice("");
      void load(true);
    };
    return () => {
      current.close();
      channel.current = null;
    };
  }, []);

  function message(err: unknown) {
    return err instanceof Error ? err.message : "操作失败，请重试";
  }
  function clearSession(text: string) {
    setActiveUser("");
    channel.current?.postMessage("changed");
    epoch.current++;
    answerConfirmation(false);
    running.current = false;
    setBusy(false);
    setUser(null);
    setNickname("");
    setAvatarDraft(null);
    setFlow(null);
    setEmail("");
    setView("login");
    setNotice(text);
  }
  async function run(action: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    const generation = epoch.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (err) {
      if (generation !== epoch.current) return;
      if (user && err instanceof APIError && err.status === 401)
        clearSession("登录已失效，请重新登录");
      else setError(message(err));
    } finally {
      if (generation === epoch.current) {
        running.current = false;
        setBusy(false);
      }
    }
  }
  async function runConfirmed(
    options: ConfirmationOptions,
    action: () => Promise<void>,
  ) {
    const generation = epoch.current;
    if (!(await confirmAction(options)) || generation !== epoch.current) return;
    await run(action);
  }
  async function refresh() {
    const generation = epoch.current;
    const me = await api<User>("/me");
    if (generation !== epoch.current)
      throw new APIError(409, "账号已切换，请重新操作");
    setActiveUser(me.id);
    setUser(me);
    return me;
  }
  async function navigate(next: View) {
    if (busy) return false;
    if (next === view) {
      setFlow(null);
      setError("");
      setNotice("");
      return true;
    }
    await routeNavigate(
      accountPaths[next] +
        (isAuthPage(next) && isAuthPage(page) ? location.search : ""),
    );
    return true;
  }
  async function logout(all: boolean, context?: "onboarding") {
    const unsaved =
      view === "profile" &&
      user &&
      (nickname !== user.nickname || avatarDraft !== null);
    await runConfirmed(
      {
        title: all ? "退出全部设备？" : "退出登录？",
        text:
          context === "onboarding"
            ? "退出后返回登录页。已提交的回答会保留，当前未提交的内容将丢失。"
            : (all
                ? "当前及其他设备都会退出，需要重新登录才能继续使用。"
                : "当前设备将退出，需要重新登录才能继续使用。") +
              (unsaved
                ? "资料尚未保存，退出后这些修改将丢失。"
                : "已保存的资料会保留。"),
        confirmLabel: all ? "退出全部设备" : "退出登录",
      },
      async () => {
        await api(all ? "/auth/logout-all" : "/auth/logout", "POST", {});
        clearSession(all ? "已退出全部设备" : "已退出登录");
      },
    );
  }
  function sendCode(purpose: "register" | "reset", target: string) {
    return run(async () => {
      const result = await api<{ flow: string }>(
        `/auth/${purpose}/start`,
        "POST",
        { email: target },
      );
      setFlow({ id: result.flow, email: target, sentAt: Date.now() });
      setEmail(target);
    });
  }
  function sendEmailCode(target: string) {
    return run(async () => {
      const result = await api<{ flow: string }>("/me/email/start", "POST", {
        email: target,
      });
      setFlow({ id: result.flow, email: target, sentAt: Date.now() });
      setNotice("验证码已分别发送至原邮箱和新邮箱，请使用最新收到的验证码");
    });
  }
  async function login(data: FormData) {
    await run(async () => {
      await api("/auth/login", "POST", {
        email: data.get("email"),
        password: data.get("password"),
      });
      channel.current?.postMessage("changed");
      await load();
    });
  }

  return {
    policy,
    user,
    view,
    loading,
    offline,
    busy,
    error,
    notice,
    flow,
    email,
    nickname,
    avatarDraft,
    confirmation,
    load,
    login,
    navigate,
    logout,
    sendCode,
    sendEmailCode,
    run,
    runConfirmed,
    refresh,
    clearSession,
    setView,
    setFlow,
    setEmail,
    setNickname,
    setAvatarDraft,
    setError,
    setNotice,
    answerConfirmation,
  };
}

export type AccountController = ReturnType<typeof useAccount>;

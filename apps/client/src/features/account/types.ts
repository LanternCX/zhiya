export type View =
  | "home"
  | "login"
  | "register"
  | "reset"
  | "profile"
  | "security"
  | "password"
  | "email"
  | "delete";
export type Flow = {
  id: string;
  email: string;
  sentAt: number;
  role?: "teacher" | "student";
};

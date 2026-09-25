import { rotateToken } from "@fixture/auth";

export function signIn(): string {
  return rotateToken("fixture-token");
}

import { modelFailure, modelSuccess, type ModelResult } from "../result";

/**
 * Sensitive SSH authentication material. This type belongs to launch
 * configuration only; it must never be copied into a runtime `Terminal`.
 */
export type SshAuthentication =
  | {
      readonly kind: "password";
      readonly password: string;
    }
  | {
      readonly kind: "private-key";
      readonly keyFile: string;
      readonly passphrase?: string;
    };

export type SshAuthenticationInput =
  | {
      kind: "password";
      password: string;
    }
  | {
      kind: "private-key";
      keyFile: string;
      passphrase?: string;
    };

export function createSshAuthentication(
  input: SshAuthenticationInput,
): ModelResult<SshAuthentication> {
  if (input.kind === "password") {
    if (!input.password) {
      return modelFailure("invalid-value", "SSH password must not be empty");
    }
    return modelSuccess({
      kind: "password",
      password: input.password,
    });
  }

  const keyFile = input.keyFile.trim();
  if (!keyFile) {
    return modelFailure("invalid-value", "SSH key file must not be empty");
  }

  return modelSuccess({
    kind: "private-key",
    keyFile,
    ...(input.passphrase ? { passphrase: input.passphrase } : {}),
  });
}

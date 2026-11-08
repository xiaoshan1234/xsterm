import { createSshCredentialId, type SshCredentialId } from "../ids";
import { modelFailure, modelSuccess, type ModelResult } from "../result";

/**
 * SSH authentication metadata stored in domain and persistence models.
 * Passwords and passphrases are intentionally replaced by credential ids that
 * are resolved by the security infrastructure only when connecting.
 */
export type SshAuthentication =
  | {
      readonly kind: "password";
      readonly credentialId: SshCredentialId;
    }
  | {
      readonly kind: "private-key";
      readonly keyFile: string;
      readonly passphraseCredentialId?: SshCredentialId;
    };

export type SshAuthenticationInput =
  | {
      kind: "password";
      credentialId: string;
    }
  | {
      kind: "private-key";
      keyFile: string;
      passphraseCredentialId?: string;
    };

export function createSshAuthentication(
  input: SshAuthenticationInput,
): ModelResult<SshAuthentication> {
  if (input.kind === "password") {
    try {
      return modelSuccess({
        kind: "password",
        credentialId: createSshCredentialId(input.credentialId),
      });
    } catch (error) {
      return modelFailure(
        "invalid-id",
        error instanceof Error ? error.message : "Invalid SSH credential id",
      );
    }
  }

  const keyFile = input.keyFile.trim();
  if (!keyFile) {
    return modelFailure("invalid-value", "SSH key file must not be empty");
  }

  let passphraseCredentialId: SshCredentialId | undefined;
  if (input.passphraseCredentialId !== undefined) {
    try {
      passphraseCredentialId = createSshCredentialId(input.passphraseCredentialId);
    } catch (error) {
      return modelFailure(
        "invalid-id",
        error instanceof Error ? error.message : "Invalid SSH passphrase credential id",
      );
    }
  }

  return modelSuccess({
    kind: "private-key",
    keyFile,
    ...(passphraseCredentialId ? { passphraseCredentialId } : {}),
  });
}

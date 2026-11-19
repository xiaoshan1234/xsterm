import type { SshConfig } from "../../launch-config";
import type { SshConfigDto } from "../infrastructure";

export function toSshConfigDto(config: SshConfig): SshConfigDto {
  const { authType, keyFile, ...rest } = config;
  return {
    ...rest,
    auth_type: authType,
    ...(keyFile !== undefined ? { key_file: keyFile } : {}),
  };
}

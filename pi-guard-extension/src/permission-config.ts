/**
 * @deprecated This module is being replaced by Guard Plan Mode modules.
 * Retained as a stub for backward compatibility during migration.
 * Will be removed when index.ts is rewritten in upcoming tickets.
 */

export interface PermissionConfig {
  permission?: Record<string, unknown>;
  autoActivateAfterSkill?: boolean;
}

export interface PermissionConfigResult {
  global: PermissionConfig;
  project: PermissionConfig;
}

export function loadPermissionConfig(projectRoot?: string): PermissionConfigResult {
  return { global: {}, project: {} };
}

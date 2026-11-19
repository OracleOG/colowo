import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { permissions, rolePermissions, roles } from "@/db/schema";
import { DEFAULT_ROLES, PERMISSIONS } from "@/lib/permissions";

/** Upsert the permission catalogue and default roles. Safe to run repeatedly. */
export async function syncRolesAndPermissions(tx: DbOrTx) {
  for (const [code, description] of Object.entries(PERMISSIONS)) {
    await tx
      .insert(permissions)
      .values({ code, description })
      .onConflictDoUpdate({ target: permissions.code, set: { description } });
  }
  for (const [code, role] of Object.entries(DEFAULT_ROLES)) {
    const [row] = await tx
      .insert(roles)
      .values({ code, name: role.name, description: role.description })
      .onConflictDoUpdate({ target: roles.code, set: { name: role.name, description: role.description } })
      .returning();
    await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, row.id));
    await tx
      .insert(rolePermissions)
      .values(role.permissions.map((p) => ({ roleId: row.id, permissionCode: p })));
  }
}

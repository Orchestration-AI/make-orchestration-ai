// @deno-types="npm:@types/mssql@9.1.5"
import sql from "mssql";
import type { Setting } from "@orchestration-ai/sdk/services";
import { getBooleanSetting, getTextSetting } from "@orchestration-ai/sdk/services";
import {
  sqlServerConnectionStringKey,
  sqlServerRemoveBackslashOnDatesKey,
} from "./sql-server.constants.ts";

export async function runQuery(query: string, settings: Setting[]) {
  const connString = getTextSetting(
    settings,
    sqlServerConnectionStringKey
  )!;
  const removeBackslashes = getBooleanSetting(
    settings,
    sqlServerRemoveBackslashOnDatesKey
  );

  const pool = new sql.ConnectionPool(
    sql.ConnectionPool.parseConnectionString(connString)
  );
  await pool.connect();

  const tx = pool.transaction();
  await tx.begin();
  try {
    if (removeBackslashes) {
      query = query.replace(/\\'/g, "'");
    } else {
      // Do not remove the backslashes as per setting.
    }

    const request = new sql.Request(pool);
    const response = await request.query(query);
    const out = response.recordset;

    await tx.commit();
    await pool.close();

    return out;
  } catch (e) {
    await tx.rollback();
    await pool.close();

    throw e;
  }
}

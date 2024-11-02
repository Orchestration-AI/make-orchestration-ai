// @deno-types="npm:@types/mssql@9.1.5"
import sql from "mssql";
import type { Context } from "../types.ts";
import { getBooleanSetting, getTextSetting } from "../utils.ts";
import {
  sqlServerConnectionStringKey,
  sqlServerRemoveBackslashOnDatesKey,
} from "./sql-server.constants.ts";

export async function runQuery(query: string, context: Context) {
  const connString = getTextSetting(
    context.settings,
    sqlServerConnectionStringKey
  )!;
  const removeBackslashes = getBooleanSetting(
    context.settings,
    sqlServerRemoveBackslashOnDatesKey
  );

  const pool = new sql.ConnectionPool(
    sql.ConnectionPool.parseConnectionString(connString)
  );
  pool.connect();

  const tx = pool.transaction();
  try {
    if (removeBackslashes) {
      query = query.replace(/\\'/g, "'");
    } else {
      // Do not remove the backslashes as per setting.
    }

    const request = new sql.Request(pool);
    const response = await request.query(query);
    const out = response.recordset;

    tx.commit();
    pool.close();

    return out;
  } catch (e) {
    tx.rollback();
    pool.close();

    throw e;
  }
}

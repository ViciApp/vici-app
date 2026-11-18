// Runtime application settings: admin-managed JSON values keyed by name,
// for configuration that must live outside the repo and be flippable
// without a deploy (feature kill switches, operational toggles). Services
// read through readAppSetting; a missing key means "not configured".

import { isNullish, nonNullish } from '@dfinity/utils';
import { query } from '../db/client';

export interface AppSetting {
	key: string;
	value: unknown;
	updatedAt: string;
}

interface AppSettingRow {
	key: string;
	value: unknown;
	updated_at: Date;
}

const shapeSetting = (row: AppSettingRow): AppSetting => ({
	key: row.key,
	value: row.value,
	updatedAt: row.updated_at.toISOString()
});

/** Typed read of one setting's value; undefined when the key is absent. */
export const readAppSetting = async <T>(key: string): Promise<T | undefined> => {
	const rows = await query<{ value: T }>(`select value from app_settings where key = $1`, [key]);

	return rows[0]?.value;
};

export const listAppSettings = async (): Promise<AppSetting[]> => {
	const rows = await query<AppSettingRow>(
		`select key, value, updated_at from app_settings order by key`
	);

	return rows.map(shapeSetting);
};

export const getAppSetting = async (key: string): Promise<AppSetting | undefined> => {
	const rows = await query<AppSettingRow>(
		`select key, value, updated_at from app_settings where key = $1`,
		[key]
	);

	return isNullish(rows[0]) ? undefined : shapeSetting(rows[0]);
};

export const upsertAppSetting = async ({
	key,
	value
}: {
	key: string;
	value: unknown;
}): Promise<AppSetting> => {
	const rows = await query<AppSettingRow>(
		`insert into app_settings (key, value)
		 values ($1, $2)
		 on conflict (key) do update set value = excluded.value, updated_at = now()
		 returning key, value, updated_at`,
		[key, JSON.stringify(value)]
	);
	const [row] = rows;

	if (isNullish(row)) {
		throw new Error('app setting upsert returned no row');
	}

	return shapeSetting(row);
};

export const deleteAppSetting = async (key: string): Promise<{ deleted: boolean }> => {
	const rows = await query<{ key: string }>(
		`delete from app_settings where key = $1 returning key`,
		[key]
	);

	return { deleted: nonNullish(rows[0]) };
};

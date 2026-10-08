import React from 'react';

import type { NarrationConnection } from './narration-drafts';

export function NarrationConnectionFields({
	value,
	onChange,
	serverConfigured,
	useServer,
	onUseServer,
}: {
	value: NarrationConnection;
	onChange: (value: NarrationConnection) => void;
	serverConfigured: boolean;
	useServer: boolean;
	onUseServer: (value: boolean) => void;
}) {
	return (
		<details
			className='rounded-lg border border-slate-700 bg-slate-900/50 p-3 text-sm'
			open={!serverConfigured}
		>
			<summary className='cursor-pointer font-semibold'>
				模型配置 · {serverConfigured ? '服务端已配置' : '需要配置 API Key'}
			</summary>
			<label className='my-2 flex gap-2'>
				<input
					type='checkbox'
					checked={useServer}
					onChange={(e) => onUseServer(e.target.checked)}
				/>
				使用服务端配置
			</label>
			{!useServer && (
				<div className='grid gap-2 md:grid-cols-3'>
					<label>
						API 地址
						<input
							aria-label='讲稿模型 API 地址'
							className='mt-1 w-full rounded border border-slate-600 bg-slate-950 p-2 text-slate-100'
							value={value.baseURL}
							onChange={(e) => onChange({ ...value, baseURL: e.target.value })}
						/>
					</label>
					<label>
						模型名称
						<input
							aria-label='讲稿模型名称'
							className='mt-1 w-full rounded border border-slate-600 bg-slate-950 p-2 text-slate-100'
							value={value.model}
							onChange={(e) => onChange({ ...value, model: e.target.value })}
						/>
					</label>
					<label>
						API Key
						<input
							aria-label='讲稿模型 API Key'
							type='password'
							autoComplete='off'
							className='mt-1 w-full rounded border border-slate-600 bg-slate-950 p-2 text-slate-100'
							value={value.apiKey}
							onChange={(e) => onChange({ ...value, apiKey: e.target.value })}
						/>
					</label>
				</div>
			)}
			<p className='mt-2 text-xs text-slate-500'>
				兼容纯文本聊天模型。密钥仅保留在此面板会话，不保存到项目。点击生成会将整理后的课件文字发送给所选模型服务。
			</p>
		</details>
	);
}

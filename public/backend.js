export const accountAuth = null;

export async function api(path, data) {
  const response = await fetch('/api/' + path, data === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  let result;
  try { result = await response.json(); } catch { throw new Error('无法连接到账本服务。'); }
  if (!response.ok) {
    const error = new Error(result.error ?? '操作失败，请稍后重试。');
    error.status = response.status;
    throw error;
  }
  return result;
}

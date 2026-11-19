export const usernamePattern = /^[A-Za-z0-9][A-Za-z0-9_-]{4,23}$/;
export const usernameHint = '用户名需为 5–24 位，以英文字母或数字开头，可使用下划线和连字符。';
export const passwordHint = '密码需为 8–32 位，以英文字母或数字开头，并包含大写、小写、数字或符号中的至少三类。';

export function usernameEmail(username) {
  return `${username.toLowerCase()}@accounts.wallet.invalid`;
}

export function registrationError(username, password) {
  if (!usernamePattern.test(username)) return usernameHint;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[()!@#$%^&*|?><_-]/];
  const valid = password.length >= 8 && password.length <= 32 &&
    /^[A-Za-z0-9]/.test(password) && !password.includes('\0') &&
    new TextEncoder().encode(password).length <= 72 &&
    classes.filter(pattern => pattern.test(password)).length >= 3;
  return valid ? '' : passwordHint;
}

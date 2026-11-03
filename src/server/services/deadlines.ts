export function isDeadlinePassed(deadline: Date | null, now = new Date()) {
  return deadline !== null && now.getTime() > deadline.getTime();
}

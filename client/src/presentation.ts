export function initials(name: string) {
  return name.trim().split(/\s+/).map(word => word[0]).slice(0, 2).join('').toUpperCase() || 'BT';
}

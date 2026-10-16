export const CAR_PURCHASE_ROUTES = [
  'recommended-plan', 'customize', 'personal-details', 'review',
];

export function purchaseEntryPath(pathname) {
  const separator = pathname.lastIndexOf('/');
  if (separator < 1) return null;
  return CAR_PURCHASE_ROUTES.includes(pathname.slice(separator + 1))
    ? pathname.slice(0, separator) : null;
}

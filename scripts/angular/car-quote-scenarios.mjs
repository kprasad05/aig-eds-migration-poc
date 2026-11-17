import { calendarDate, carPricingInputs, validateCarDetails } from './car-quote.mjs';

const PLAN_COLUMNS = { 'collision-only': 'CollisionOnlyPremium', complete: 'CompletePremium' };
const ADD_ON_COLUMNS = {
  'driver-extension': 'DriverExtensionPremium', 'loss-of-use': 'LossOfUsePremium',
  'glass-roof': 'GlassRoofPremium', 'canvas-top': 'CanvasTopPremium',
};
const SELECTORS = {
  VehicleType: ['sedan', 'suv', 'electric'],
  AgeBand: ['21-24', '25-39', '40-65'],
  NCD: ['0', '10', '20', '30', '40', '50'],
  ClaimCount: ['0', '1'],
  PromoCode: ['none', 'DEMO10'],
};

export const SCENARIO_COLUMNS = [
  'Scenario', ...Object.keys(SELECTORS), 'Currency', 'RecommendedPlanId', 'TaxRate',
  ...Object.values(PLAN_COLUMNS), ...Object.values(ADD_ON_COLUMNS),
];

function selectorKey(values) {
  return Object.keys(SELECTORS).map((column) => values[column]).join('|');
}

function price(row, column) {
  const value = row[column];
  if (!['number', 'string'].includes(typeof value)
    || !/^\d+(?:\.\d{1,2})?$/.test(String(value).trim())) {
    throw new Error(`Quote scenario ${row.Scenario}: ${column} must be a nonnegative amount with at most two decimal places.`);
  }
  const amount = Number(value);
  if (!Number.isFinite(amount) || !Number.isSafeInteger(Math.round(amount * 100))) {
    throw new Error(`Quote scenario ${row.Scenario}: ${column} is outside the supported numeric range.`);
  }
  return amount;
}

export function parseScenarioSheet(sheet) {
  if (!sheet || !Array.isArray(sheet.data) || !sheet.data.length) {
    throw new Error('The quote scenario sheet needs a nonempty data array. Save and preview/publish the sheet.');
  }
  if ((typeof sheet.total === 'number' && sheet.total > sheet.data.length)
    || (typeof sheet.offset === 'number' && sheet.offset !== 0)) {
    throw new Error('The quote scenario sheet is incomplete. Deliver all scenario rows together.');
  }
  const ids = new Set();
  const keys = new Set();
  return sheet.data.map((row) => {
    if (!row || typeof row !== 'object' || typeof row.Scenario !== 'string' || !row.Scenario.trim()) {
      throw new Error('Every quote scenario needs a Scenario identifier.');
    }
    const id = row.Scenario.trim();
    const selectors = {};
    for (const [column, allowed] of Object.entries(SELECTORS)) {
      const value = ['number', 'string'].includes(typeof row[column]) ? String(row[column]).trim() : '';
      if (!allowed.includes(value)) throw new Error(`Quote scenario ${id}: unsupported ${column}.`);
      selectors[column] = value;
    }
    const key = selectorKey(selectors);
    if (ids.has(id) || keys.has(key)) throw new Error(`Quote scenario ${id}: duplicate identifier or matching conditions.`);
    ids.add(id);
    keys.add(key);
    if (row.Currency !== 'SGD' || !Object.hasOwn(PLAN_COLUMNS, row.RecommendedPlanId)) {
      throw new Error(`Quote scenario ${id}: use SGD and a supported recommended plan ID.`);
    }
    const tax = row.TaxRate;
    if (!['number', 'string'].includes(typeof tax) || !/^\d+(?:\.\d+)?$/.test(String(tax).trim())
      || !Number.isFinite(Number(tax)) || Number(tax) < 0 || Number(tax) > 1) {
      throw new Error(`Quote scenario ${id}: TaxRate must be between 0 and 1 (for example 0.09).`);
    }
    const prices = (columns) => Object.entries(columns).map(([productId, column]) => ({
      id: productId, annualPremium: price(row, column),
    }));
    return {
      key, currency: 'SGD', recommendedPlanId: row.RecommendedPlanId, taxRate: Number(tax),
      plans: prices(PLAN_COLUMNS), addOns: prices(ADD_ON_COLUMNS),
    };
  });
}

export function createScenarioQuote(sheet, request, now = new Date()) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new Error('Complete the car quote request before selecting a scenario.');
  }
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (!calendarDate(request.coverStart) || request.coverStart < today) {
    throw new Error('Cover start must be a real date today or later.');
  }
  validateCarDetails(request.car, request.coverStart, now);
  const expected = carPricingInputs(request.car, request.coverStart);
  if (request.vehicleType !== expected.vehicleType || request.ageBand !== expected.ageBand) {
    throw new Error('Vehicle and age pricing inputs must match the car details.');
  }
  const key = selectorKey({
    VehicleType: request.vehicleType, AgeBand: request.ageBand, NCD: request.car.ncd,
    ClaimCount: request.car.claimCount, PromoCode: request.car.promoCode || 'none',
  });
  const scenario = parseScenarioSheet(sheet).find((row) => row.key === key);
  if (!scenario) {
    throw new Error('No mock quote scenario matches these answers. Add the matching vehicle, age, NCD, claims and promotion row to the sheet.');
  }
  return {
    currency: scenario.currency, recommendedPlanId: scenario.recommendedPlanId,
    taxRate: scenario.taxRate, plans: scenario.plans, addOns: scenario.addOns,
    id: `DEMO-${crypto.randomUUID()}`,
    expiresAt: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
  };
}

export async function loadScenarioQuote(url, request) {
  const response = await fetch(url, { credentials: 'omit', cache: 'no-store' });
  if (!response.ok) throw new Error(`Unable to load quote scenarios (HTTP ${response.status}).`);
  return createScenarioQuote(await response.json(), request);
}

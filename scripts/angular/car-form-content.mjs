const choices = (...pairs) => pairs.map(([name, label]) => ({ name, label }));
const sequence = (count) => Array.from({ length: count }, (_, index) => ({
  value: String(index + 1), label: String(index + 1),
}));

const GROUPS = {
  vehicle: 'Vehicle information',
  driver: 'Driver information',
  policy: 'Policy information',
  claims: 'Claim history',
  claimDetails: 'Claim details',
  claimLoss: 'Date of loss',
  discount: 'No-claim discount',
  additionalDriver: 'Additional driver information',
  additionalVehicle: 'Additional vehicle information',
  additionalCover: 'Driver and mileage coverage',
  additionalUsage: 'Vehicle usage',
};

const FIELDS = [
  ['vehicleMake', 'vehicle.make', 'Vehicle make', 'select', 'vehicle', 'vehicle-make', choices(
    ['toyota', 'Toyota'], ['honda', 'Honda'],
    ['hyundai', 'Hyundai'], ['deepal', 'Deepal'],
  )],
  ['vehicleModel', 'vehicle.model', 'Vehicle model', 'select', 'vehicle', 'vehicle-model'],
  ['registrationYear', 'vehicle.registrationYear', 'Registration year', 'select', 'vehicle', 'registration-year'],
  ['dobDay', 'driver.dateOfBirth.day', 'Birth day', 'select', 'driver', 'dob-day', sequence(31)],
  ['dobMonth', 'driver.dateOfBirth.month', 'Birth month', 'select', 'driver', 'dob-month', sequence(12)],
  ['dobYear', 'driver.dateOfBirth.year', 'Birth year', 'text', 'driver', 'dob-year'],
  ['occupation', 'driver.occupation', 'Occupation', 'select', 'driver', 'occupation', choices(
    ['professional', 'Professional'], ['manager', 'Manager'],
    ['clerical', 'Clerical'], ['self-employed', 'Self-employed'], ['retired', 'Retired'],
  )],
  ['drivingExperience', 'driver.drivingExperience', 'Driving experience', 'number', 'driver', 'driving-years'],
  ['coverStart', 'policy.effectiveDate', 'Policy effective date', 'date', 'policy', 'effective-date'],
  ['claimCount', 'claims.count', 'Number of at-fault claims', 'select', 'claims', 'claim-count', choices(
    ['0', '0'], ['1', '1'], ['more than 1', 'More than 1'],
  )],
  ['claimAmount', 'claims.amount', 'Claim amount', 'number', 'claimDetails', 'claim-amount'],
  ['claimDay', 'claims.dateOfLoss.day', 'Loss day', 'select', 'claimLoss', 'dob-day', sequence(31)],
  ['claimMonth', 'claims.dateOfLoss.month', 'Loss month', 'select', 'claimLoss', 'dob-month', sequence(12)],
  ['claimYear', 'claims.dateOfLoss.year', 'Loss year', 'text', 'claimLoss', 'dob-year'],
  ['ncd', 'discount.ncd', 'No-claim discount', 'select', 'discount', 'ncd',
    choices(...[0, 10, 20, 30, 40, 50].map((n) => [`${n}%`, `${n}%`]))],
  ['maritalStatus', 'additionalDetails.maritalStatus', 'Marital status', 'select', 'additionalDriver', 'marital-status', choices(
    ['single', 'Single'], ['married', 'Married'], ['others', 'Others'],
  )],
  ['gender', 'additionalDetails.gender', 'Gender', 'select', 'additionalDriver', 'driver-gender', choices(
    ['male', 'Male'], ['female', 'Female'],
  )],
  ['vehicleRegistration', 'additionalDetails.registrationNumber', 'Vehicle registration number', 'text', 'additionalVehicle', 'vehicle-registration'],
  ['driverAgeCondition', 'additionalDetails.driverAgeCover', 'Driver age cover', 'select', 'additionalCover', 'driver-age-condition', choices(
    ['all ages', 'All ages'], ['30 years and above', '30 years and above'],
    ['35 years and above', '35 years and above'], ['40 years and above', '40 years and above'],
  ), 'all ages'],
  ['annualMileage', 'additionalDetails.annualMileage', 'Annual mileage', 'select', 'additionalCover', 'annual-mileage', choices(
    ['unlimited mileage', 'Unlimited mileage'],
    ['up to 10000 km annually', 'Up to 10000 km annually'],
    ['up to 5000 km annually', 'Up to 5000 km annually'],
  ), 'unlimited mileage'],
  ['offPeakCar', 'additionalDetails.offPeakCar', 'Off-peak car', 'select', 'additionalUsage', 'off-peak-car', choices(
    ['non off peak car', 'Non Off Peak Car'], ['off peak car', 'Off Peak Car'],
  ), 'non off peak car'],
  ['promoCode', 'promotion.code', 'Promo code', 'text', '', 'promo-code'],
];

const COPY = { Label: 'label', Placeholder: 'placeholder', PreText: 'before', PostText: 'after', Tooltip: 'helpText' };
const TITLES = {
  vehicle: 'Vehicle', driver: 'Driver', dateOfBirth: 'Date of birth',
  policy: 'Policy', claims: 'Claims', dateOfLoss: 'Date of loss', discount: 'No-claim discount',
  additionalDetails: 'Additional driver and vehicle details', promotion: 'Promotion',
};

export const CAR_OPTION_SCHEMA = {
  type: 'object', title: 'Option', required: ['label', 'name'],
  properties: {
    label: { type: 'string', title: 'Label', description: 'Text shown to the visitor.', minLength: 1 },
    name: {
      type: 'string', title: 'Name', minLength: 1,
      description: 'Identifier submitted by the form. The quote service must support this name.',
    },
  },
};

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function atPath(value, path) {
  return path.split('.').reduce((node, key) => object(node) ? node[key] : undefined, value);
}

function setPath(target, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  let parent = target;
  keys.forEach((key) => { parent[key] ||= {}; parent = parent[key]; });
  parent[last] = value;
}

export function createCarFormContent(rows) {
  const form = {};
  FIELDS.forEach(([name, path, , , , , options]) => {
    const row = rows.find((field) => field.Name === name);
    if (!row) throw new Error(`Missing sample field ${name}.`);
    const field = {};
    Object.entries(COPY).forEach(([column, property]) => {
      if (row[column]) field[property] = row[column];
    });
    if (options?.some((option) => option.name)) {
      field.options = options.map((option) => ({ ...option }));
    }
    setPath(form, path, field);
  });
  return form;
}

export function createCarFormSchema(sample) {
  const schema = {
    type: 'object', title: 'Car pre-quote form',
    description: 'Edit question copy and option lists for the actual car form. Layout, required questions and validation are controlled by code.',
    properties: {}, required: [],
  };
  FIELDS.forEach(([, path, title, , , , options]) => {
    const defaults = atPath(sample, path);
    const field = {
      type: 'object', title, required: ['label'], properties: {},
      description: `Presentation content for ${title.toLowerCase()}, not a customer answer.`,
    };
    Object.entries({
      label: 'Accessible label', placeholder: 'Placeholder',
      before: 'Sentence text before this input', after: 'Sentence text after this input',
      helpText: 'Help text behind the question mark',
    }).forEach(([key, label]) => {
      if (key !== 'helpText' && defaults[key] === undefined) return;
      field.properties[key] = {
        type: 'string', title: label,
        ...(defaults[key] ? { default: defaults[key] } : {}),
        ...(key === 'label' ? { minLength: 1 } : {}),
        ...(key === 'helpText' ? { 'x-semantic-type': 'long-text' } : {}),
      };
    });
    if (options?.some((option) => option.name)) {
      field.required.push('options');
      field.properties.options = {
        type: 'array', title: `${title} options`, minItems: 1,
        description: 'Add, remove or reorder options. Each option has a visitor-facing Label and a unique Name supported by the quote service.',
        default: defaults.options.map((option) => ({ ...option })),
        items: { $ref: '#/$defs/CarOption' },
      };
    }
    const keys = path.split('.');
    const last = keys.pop();
    let parent = schema;
    keys.forEach((key) => {
      if (!parent.properties[key]) {
        parent.properties[key] = { type: 'object', title: TITLES[key], properties: {}, required: [] };
        parent.required.push(key);
      }
      parent = parent.properties[key];
    });
    parent.properties[last] = field;
    parent.required.push(last);
  });
  return schema;
}

export function createStructuredCarDefinition(form, buttonLabel, assetBase, now = new Date()) {
  if (!object(form) || form.data !== undefined) {
    throw new Error('Car form content needs named Vehicle, Driver and Claims sections. Reimport the updated car-journey content.');
  }
  if (typeof buttonLabel !== 'string' || !buttonLabel.trim()) {
    throw new Error('Author the get-a-quote button text.');
  }
  const data = [];
  const seen = new Set();
  FIELDS.forEach(([name, path, , type, group, style, options, initial]) => {
    const field = atPath(form, path);
    if (!object(field) || typeof field.label !== 'string' || !field.label.trim()) {
      throw new Error(`Author a label for carForm.${path}.`);
    }
    if (group && !seen.has(group)) {
      data.push({ Name: group, Type: 'fieldset', Label: GROUPS[group], Style: 'quote-line' });
      seen.add(group);
    }
    const row = {
      Name: name, Type: type, Style: style, Fieldset: group,
      Mandatory: name === 'promoCode' ? '' : 'true',
      ...(initial ? { Value: initial } : {}),
    };
    Object.entries(COPY).forEach(([column, property]) => {
      if (field[property] !== undefined && typeof field[property] !== 'string') {
        throw new Error(`carForm.${path}.${property} must be text.`);
      }
      row[column] = field[property] || '';
    });
    if (options) {
      if (options.some((option) => option.name)) {
        if (field.choices !== undefined || !Array.isArray(field.options)) {
          throw new Error(`carForm.${path} needs an options list with Label and Name. Reimport the updated car-journey content.`);
        }
        if (!field.options.length) throw new Error(`Author at least one option in carForm.${path}.`);
        row.Options = field.options.map((option, index) => {
          if (!object(option)) throw new Error(`carForm.${path}.options[${index}] must contain Label and Name.`);
          const text = (value) => {
            // DA's HTML-to-JSON conversion can infer numbers for text such as "0".
            return typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
          };
          const label = text(option.label);
          const name = text(option.name);
          if (typeof label !== 'string' || !label.trim()
            || typeof name !== 'string' || !name.trim()) {
            throw new Error(`Author Label and Name for carForm.${path}.options[${index}].`);
          }
          return { Option: label.trim(), Value: name.trim() };
        });
        const names = row.Options.map((option) => option.Value);
        if (new Set(names).size !== names.length) {
          throw new Error(`Option names in carForm.${path} must be distinct.`);
        }
      } else {
        row.Options = options.map((option) => ({ Option: option.label, Value: option.value }));
      }
      const labels = row.Options.map((option) => option.Option.trim().toLowerCase());
      if (new Set(labels).size !== labels.length) {
        throw new Error(`Option labels in carForm.${path} must be distinct.`);
      }
    } else if (name === 'vehicleModel') {
      row.Options = new URL('/purchase-data/car/vehicle-models.json', assetBase).href;
    } else if (name === 'registrationYear') {
      row.Options = Array.from({ length: 13 }, (_, index) => {
        const value = String(now.getFullYear() - index - 1);
        return { Option: value, Value: value };
      });
    }
    data.push(row);
  });
  data.push({ Name: 'submit', Type: 'submit', Label: buttonLabel, Style: 'submit-quote' });
  return { data };
}

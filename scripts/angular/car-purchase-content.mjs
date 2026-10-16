export const PERSONAL_DETAIL_SECTIONS = [
  { id: 'insured', fields: [
    { name: 'name', maxLength: 80 },
    { name: 'residentialStatus', type: 'select', optionValues: ['1', '2', '3'] },
    { name: 'nationality', type: 'select', optionValues: ['1', '2', '3'] },
    { name: 'nric', pattern: 'DEMO-[A-Z0-9]{4,20}' },
    { name: 'email', type: 'email', maxLength: 254 },
    { name: 'mobileNo', pattern: '[0-9]{8}', maxLength: 8 },
    { name: 'blockNo', maxLength: 30 },
    { name: 'address', maxLength: 200 },
    { name: 'unitNo', optional: true, maxLength: 30 },
    { name: 'postalCode', pattern: '[0-9]{6}', maxLength: 6 },
  ] },
  { id: 'vehicle', fields: [
    { name: 'engineNo', maxLength: 40 },
    { name: 'chassisNo', maxLength: 40 },
    { name: 'hirePurchaseCompany', type: 'select', optionValues: ['1', '2'] },
    { name: 'noClaimExperience', type: 'select', condition: 'ncd', optionValues: ['1', '2', '3', '4'] },
    { name: 'noClaimExperienceOther', condition: 'other', maxLength: 200 },
    { name: 'previousInsurer', type: 'select', optionValues: ['1', '2'] },
    { name: 'prevRegOrPolNo', maxLength: 100 },
    { name: 'mileageDeclaration', condition: 'mileage', pattern: '[0-9]{1,8}', maxLength: 8 },
  ] },
  { id: 'claims', fields: [
    { name: 'lossDescription', condition: 'claim', maxLength: 300 },
    { name: 'natureOfClaim', type: 'select', condition: 'claim', optionValues: ['1', '2', '3', '4', '5', '6'] },
    { name: 'statusOfClaim', type: 'select', condition: 'claim', optionValues: ['1', '2'] },
  ] },
];

export const WIZARD_COPY_KEYS = {
  labels: [
    'recommendedStep', 'customizeStep', 'detailsStep', 'reviewStep',
    'benefits', 'recommended', 'selectPlan', 'selectPlanLabel', 'selectedPlan', 'planHighlights', 'excess',
    'addToPlan', 'added', 'selectPlaceholder', 'next', 'saveQuote', 'premiumPayable',
    'editDetails', 'none', 'notProvided', 'yes', 'no', 'unlimitedMileage', 'allAges',
  ],
  review: ['policyTitle', 'insuredTitle', 'claimsTitle', 'contactTitle'],
  saveQuote: ['title', 'intro', 'nameLabel', 'mobileLabel', 'emailLabel', 'saveButton', 'closeLabel', 'unavailableMessage'],
};

export const REVIEW_LABEL_KEYS = [
  'effective', 'coverage', 'addOns', 'vehicle', 'registrationYear', 'registrationNumber',
  'ncd', 'annualMileage', 'ageCondition', 'offPeakCar', 'engineNo', 'chassisNo',
  'hirePurchaseCompany', 'previousInsurer', 'prevRegOrPolNo', 'noClaimExperience',
  'noClaimExperienceOther', 'mileageDeclaration', 'name', 'residentialStatus',
  'nationality', 'nric', 'dateOfBirth', 'gender', 'maritalStatus', 'occupation',
  'drivingExperience', 'claimCount', 'claimDate', 'claimAmount', 'lossDescription',
  'natureOfClaim', 'statusOfClaim', 'email', 'mobileNo', 'address',
];

const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
const fail = (message) => {
  throw new Error(`Invalid car purchase authoring: ${message}. Reimport the updated car-journey schema/content or regular DA tables.`);
};

export function assertPurchaseAuthoring(purchase) {
  if (!record(purchase)) fail('missing wizard copy');
  for (const [group, keys] of Object.entries(WIZARD_COPY_KEYS)) {
    if (!record(purchase[group]) || !keys.every((key) => nonempty(purchase[group][key]))) {
      fail(`complete all ${group} text`);
    }
  }
  if (!record(purchase.review.labels) || !REVIEW_LABEL_KEYS.every((key) => nonempty(purchase.review.labels[key]))) {
    fail('complete all review labels');
  }
  if (!record(purchase.personalDetails)) fail('missing Personal Details sections');
  for (const section of PERSONAL_DETAIL_SECTIONS) {
    const copy = purchase.personalDetails[section.id];
    if (!record(copy) || !nonempty(copy.title) || !record(copy.fields)) fail(`complete the ${section.id} section`);
    if (Object.keys(copy.fields).some((name) => !section.fields.some((field) => field.name === name))) {
      fail(`unsupported field in ${section.id}`);
    }
    for (const field of section.fields) {
      const presentation = copy.fields[field.name];
      if (!record(presentation) || !nonempty(presentation.label) || !nonempty(presentation.errorMessage)) {
        fail(`${field.name} needs a label and validation message`);
      }
      if (Object.keys(presentation).some((key) =>
        !['label', 'errorMessage', 'hint', 'placeholder', 'patternMessage', 'options'].includes(key))) {
        fail(`${field.name} contains unsupported presentation properties; rules stay in code`);
      }
      for (const key of ['hint', 'placeholder', 'patternMessage']) {
        if (presentation[key] !== undefined && typeof presentation[key] !== 'string') fail(`${field.name}.${key} must be text`);
      }
      if (field.name === 'nric' && !nonempty(presentation.patternMessage)) fail('NRIC/FIN needs its demo-format message');
      if (field.optionValues) {
        const options = presentation.options;
        if (!Array.isArray(options) || options.length !== field.optionValues.length
          || options.some((option) => !record(option) || !nonempty(option.label)
            || !['string', 'number'].includes(typeof option.value)
            || !field.optionValues.includes(String(option.value).trim()))
          || new Set(options.map((option) => String(option.value).trim())).size !== field.optionValues.length) {
          fail(`${field.name} needs all supported option IDs, once each`);
        }
      } else if (presentation.options !== undefined) fail(`${field.name} does not support options`);
    }
  }
}

export function personalSections(purchase) {
  assertPurchaseAuthoring(purchase);
  return PERSONAL_DETAIL_SECTIONS.map((section) => ({
    id: section.id,
    title: purchase.personalDetails[section.id].title,
    fields: section.fields.map((rule) => ({
      ...purchase.personalDetails[section.id].fields[rule.name], ...rule,
      ...(rule.optionValues ? { options: purchase.personalDetails[section.id].fields[rule.name].options
        .map((option) => ({ value: String(option.value).trim(), label: option.label })) } : {}),
    })),
  }));
}

export function wizardCopyRows(purchase) {
  assertPurchaseAuthoring(purchase);
  return [
    ...Object.entries(WIZARD_COPY_KEYS).flatMap(([group, keys]) =>
      keys.map((key) => [`${group}.${key}`, purchase[group][key]])),
    ...REVIEW_LABEL_KEYS.map((key) => [`review.labels.${key}`, purchase.review.labels[key]]),
  ];
}

export function createPurchaseAuthoringSchema(purchase) {
  assertPurchaseAuthoring(purchase);
  const text = (title, value) => ({ type: 'string', title, minLength: 1, default: value });
  const group = (title, properties) => ({
    type: 'object', title, required: Object.keys(properties), properties,
  });
  const properties = Object.fromEntries(Object.entries(WIZARD_COPY_KEYS).map(([name, keys]) => [
    name, group(name === 'labels' ? 'Wizard labels and buttons' : name === 'review' ? 'Review' : 'Save quote popup',
      Object.fromEntries(keys.map((key) => [key, text(key, purchase[name][key])]))),
  ]));
  properties.review.properties.labels = group('Review field labels', Object.fromEntries(
    REVIEW_LABEL_KEYS.map((key) => [key, text(key, purchase.review.labels[key])]),
  ));
  properties.review.required.push('labels');
  properties.personalDetails = group('Personal Details', Object.fromEntries(
    PERSONAL_DETAIL_SECTIONS.map((section) => {
      const copy = purchase.personalDetails[section.id];
      const fields = Object.fromEntries(section.fields.map((rule) => {
        const presentation = copy.fields[rule.name];
        const field = group(presentation.label, {
          label: text('Label', presentation.label),
          errorMessage: text('Validation message', presentation.errorMessage),
        });
        field.additionalProperties = false;
        for (const key of ['hint', 'placeholder', 'patternMessage']) {
          field.properties[key] = { type: 'string', title: key, default: presentation[key] || '' };
        }
        if (rule.name === 'nric') {
          field.required.push('patternMessage');
          field.properties.patternMessage.minLength = 1;
        }
        if (rule.optionValues) {
          field.required.push('options');
          field.properties.options = {
            type: 'array', title: `${presentation.label} options`,
            minItems: rule.optionValues.length, maxItems: rule.optionValues.length,
            default: presentation.options,
            items: group('Option', {
              value: { type: 'string', title: 'Stable option ID', enum: rule.optionValues, readOnly: true },
              label: { type: 'string', title: 'Label', minLength: 1 },
            }),
          };
        }
        return [rule.name, field];
      }));
      return [section.id, group(copy.title, {
        title: text('Section heading', copy.title),
        fields: group('Questions', fields),
      })];
    }),
  ));
  return properties;
}

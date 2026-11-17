export const VEHICLES = {
  toyota: [
    { value: 'toyota-corolla', label: 'Corolla Altis', type: 'sedan' },
    { value: 'toyota-rav4', label: 'RAV4', type: 'suv' },
  ],
  honda: [
    { value: 'honda-civic', label: 'Civic', type: 'sedan' },
    { value: 'honda-hrv', label: 'HR-V', type: 'suv' },
  ],
  hyundai: [
    { value: 'hyundai-avante', label: 'Avante', type: 'sedan' },
    { value: 'hyundai-ioniq5', label: 'IONIQ 5', type: 'electric' },
  ],
  deepal: [{ value: 'deepal-s07', label: 'S07', type: 'electric' }],
};

export class CarValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.field = field;
  }
}

export function calendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function ageAt(birthday, date) {
  return Number(date.slice(0, 4)) - Number(birthday.slice(0, 4))
    - (date.slice(5) < birthday.slice(5) ? 1 : 0);
}

export function vehicleFor(car) {
  return VEHICLES[car.vehicleMake]?.find((vehicle) => vehicle.value === car.vehicleModel);
}

export function validateDriverDOB(birthday, coverStart) {
  if (!calendarDate(birthday) || !calendarDate(coverStart)) {
    throw new CarValidationError('Enter a real date of birth and policy start date.', 'dobYear');
  }
  const age = ageAt(birthday, coverStart);
  if (age < 23 || age > 70) {
    throw new CarValidationError(
      'This mock quote supports drivers aged 23 to 70 at the policy start date.', 'dobYear',
    );
  }
  return age;
}

export function validateLossDate(value, now = new Date()) {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const earliest = `${now.getFullYear() - 3}${today.slice(4)}`;
  if (!calendarDate(value) || value < earliest || value > today) {
    throw new CarValidationError('Enter a loss date within the last three years, not in the future.', 'claimYear');
  }
}

const ADDITIONAL_FIELDS = ['maritalStatus', 'gender', 'vehicleRegistration',
  'driverAgeCondition', 'annualMileage', 'offPeakCar'];

function validateCarPrimaryDetails(car, coverStart, now) {
  const fail = (message, field) => { throw new CarValidationError(message, field); };
  if (!car || typeof car !== 'object' || Array.isArray(car)) {
    fail('Complete the car and driver information.', 'vehicleMake');
  }
  const keys = ['vehicleMake', 'vehicleModel', 'registrationYear', 'driverDOB', 'occupation',
    'drivingExperience', 'claimCount', 'claimAmount', 'claimDate', 'ncd', 'promoCode'];
  if (keys.some((key) => typeof car[key] !== 'string')) {
    fail('The car quote contains invalid field values.', 'vehicleMake');
  }
  if (!Object.hasOwn(VEHICLES, car.vehicleMake) || !vehicleFor(car)) {
    fail('Choose a listed vehicle make and its matching model.', 'vehicleModel');
  }
  const year = Number(car.registrationYear);
  if (!/^\d{4}$/.test(car.registrationYear)
    || year < now.getFullYear() - 13 || year > now.getFullYear() - 1) {
    fail('Choose a vehicle registration year within the last 1 to 13 years.', 'registrationYear');
  }
  const age = validateDriverDOB(car.driverDOB, coverStart);
  if (!['professional', 'manager', 'clerical', 'self-employed', 'retired'].includes(car.occupation)) {
    fail('Choose an occupation from the sample list.', 'occupation');
  }
  if (!/^\d{1,2}$/.test(car.drivingExperience)
    || Number(car.drivingExperience) < 2 || Number(car.drivingExperience) > age - 18) {
    fail('Enter at least 2 driving years, no greater than your age minus 18.', 'drivingExperience');
  }
  if (!['0', '1', '2'].includes(car.claimCount)) {
    fail('Select your number of at-fault claims.', 'claimCount');
  }
  if (car.claimCount === '2') {
    fail('More than one claim requires assisted quoting in this mock demo.', 'claimCount');
  }
  if (!['0', '10', '20', '30', '40', '50'].includes(car.ncd)) {
    fail('Choose an NCD between 0% and 50%.', 'ncd');
  }
  return age;
}

export function validateCarDetails(car, coverStart, now = new Date()) {
  const age = validateCarPrimaryDetails(car, coverStart, now);
  const fail = (message, field) => { throw new CarValidationError(message, field); };
  if (car.claimCount === '1') {
    if (!/^\d+(?:\.\d{1,2})?$/.test(car.claimAmount) || Number(car.claimAmount) <= 0) {
      fail('Enter a positive claim amount in SGD.', 'claimAmount');
    }
    validateLossDate(car.claimDate, now);
  } else if (car.claimAmount !== '' || car.claimDate !== '') {
    fail('Claim details must be empty when no claims are selected.', 'claimCount');
  }
  if (car.promoCode !== '' && car.promoCode !== 'DEMO10') {
    fail('Use DEMO10 for the sample promotion, or leave the promo code empty.', 'promoCode');
  }
  if (ADDITIONAL_FIELDS.some((key) => Object.hasOwn(car, key))) {
    if (ADDITIONAL_FIELDS.some((key) => typeof car[key] !== 'string' || !car[key])) {
      fail('Complete the additional driver and vehicle information.', 'maritalStatus');
    }
    if (!['single', 'married', 'others'].includes(car.maritalStatus)) {
      fail('Choose a listed marital status.', 'maritalStatus');
    }
    if (!['male', 'female'].includes(car.gender)) fail('Choose a listed gender.', 'gender');
    if (!/^[A-Z]{1,3}\d{1,4}[A-Z]$/.test(car.vehicleRegistration)) {
      fail('Enter a sample registration number, such as SGB1234A.', 'vehicleRegistration');
    }
    if (!['all', '30', '35', '40'].includes(car.driverAgeCondition)
      || (car.driverAgeCondition !== 'all' && Number(car.driverAgeCondition) > age)) {
      fail('Choose a driver age condition no greater than your age.', 'driverAgeCondition');
    }
    if (!['unlimited', '10000', '5000'].includes(car.annualMileage)) {
      fail('Choose a listed annual mileage allowance.', 'annualMileage');
    }
    if (!['no', 'yes'].includes(car.offPeakCar)) fail('Choose the off-peak car status.', 'offPeakCar');
  }
  return car;
}

export function carPricingInputs(car, coverStart) {
  const age = ageAt(car.driverDOB, coverStart);
  const vehicle = vehicleFor(car);
  if (!vehicle) throw new CarValidationError('Choose a listed vehicle model.', 'vehicleModel');
  return {
    vehicleType: vehicle.type,
    ageBand: age < 25 ? '21-24' : age < 40 ? '25-39' : '40-65',
  };
}

function carFormDetails(values) {
  const string = (key) => typeof values[key] === 'string' ? values[key].trim() : '';
  const claimCount = string('claimCount') === 'more than 1' ? '2' : string('claimCount');
  const car = {
    vehicleMake: string('vehicleMake'),
    vehicleModel: string('vehicleModel'),
    registrationYear: string('registrationYear'),
    driverDOB: `${string('dobYear')}-${string('dobMonth').padStart(2, '0')}-${string('dobDay').padStart(2, '0')}`,
    occupation: string('occupation'),
    drivingExperience: string('drivingExperience'),
    claimCount,
    claimAmount: claimCount === '1' ? string('claimAmount') : '',
    claimDate: claimCount === '1' ? string('claimDate')
      || `${string('claimYear')}-${string('claimMonth').padStart(2, '0')}-${string('claimDay').padStart(2, '0')}` : '',
    ncd: string('ncd').replace(/%$/, ''),
    promoCode: string('promoCode').toUpperCase(),
  };
  if (ADDITIONAL_FIELDS.some((key) => Object.hasOwn(values, key))) {
    Object.assign(car, {
      maritalStatus: string('maritalStatus'),
      gender: string('gender'),
      vehicleRegistration: string('vehicleRegistration').toUpperCase(),
      driverAgeCondition: string('driverAgeCondition') === 'all ages' ? 'all'
        : string('driverAgeCondition').split(' ')[0],
      annualMileage: {
        'unlimited mileage': 'unlimited',
        'up to 10000 km annually': '10000',
        'up to 5000 km annually': '5000',
      }[string('annualMileage')] || string('annualMileage'),
      offPeakCar: { 'non off peak car': 'no', 'off peak car': 'yes' }[string('offPeakCar')]
        || string('offPeakCar'),
    });
  }
  const coverStart = string('coverStart');
  return { car, coverStart };
}

export function validateCarPrimaryAnswers(values, now = new Date()) {
  const { car, coverStart } = carFormDetails(values);
  return validateCarPrimaryDetails(car, coverStart, now);
}

export function buildCarQuoteRequest(values, now = new Date()) {
  const { car, coverStart } = carFormDetails(values);
  validateCarDetails(car, coverStart, now);
  return { ...carPricingInputs(car, coverStart), coverStart, car };
}

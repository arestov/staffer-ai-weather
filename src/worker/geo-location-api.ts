import type { LocationSearchResult } from '../models/WeatherLocation'

export type CountryIsResponse = {
  ip: string
  country: string
}

type OpenMeteoGeocodingResult = {
  id?: number
  name: string
  latitude: number
  longitude: number
  timezone: string
  country_code: string
  country: string
  admin1?: string
}

type OpenMeteoGeocodingResponse = {
  results?: OpenMeteoGeocodingResult[]
}

export interface GeoLocationApi {
  source_name: 'geoLocation'
  errors_fields: string[]
  detectLocation(): Promise<LocationSearchResult>
  detectLocationByCoordinates(coordinates: {
    latitude: number
    longitude: number
  }): Promise<LocationSearchResult>
}

const COUNTRY_IS_URL = 'https://api.country.is/'
const OPEN_METEO_GEOCODING_BASE = 'https://geocoding-api.open-meteo.com/v1/search'

// Map common country codes to a representative city for geocoding.
const COUNTRY_CITY_MAP: Record<string, string> = {
  AD: 'Andorra la Vella',
  AE: 'Dubai',
  AF: 'Kabul',
  AL: 'Tirana',
  AM: 'Yerevan',
  AO: 'Luanda',
  AR: 'Buenos Aires',
  AT: 'Vienna',
  AU: 'Sydney',
  AZ: 'Baku',
  BA: 'Sarajevo',
  BD: 'Dhaka',
  BE: 'Brussels',
  BF: 'Ouagadougou',
  BG: 'Sofia',
  BH: 'Manama',
  BJ: 'Cotonou',
  BN: 'Bandar Seri Begawan',
  BO: 'La Paz',
  BR: 'São Paulo',
  BT: 'Thimphu',
  BW: 'Gaborone',
  BY: 'Minsk',
  BZ: 'Belmopan',
  CA: 'Toronto',
  CD: 'Kinshasa',
  CF: 'Bangui',
  CG: 'Brazzaville',
  CH: 'Zurich',
  CI: 'Abidjan',
  CL: 'Santiago',
  CM: 'Yaoundé',
  CN: 'Beijing',
  CO: 'Bogotá',
  CR: 'San José',
  CU: 'Havana',
  CV: 'Praia',
  CY: 'Nicosia',
  CZ: 'Prague',
  DE: 'Berlin',
  DJ: 'Djibouti',
  DK: 'Copenhagen',
  DO: 'Santo Domingo',
  DZ: 'Algiers',
  EC: 'Quito',
  EE: 'Tallinn',
  EG: 'Cairo',
  ER: 'Asmara',
  ES: 'Madrid',
  ET: 'Addis Ababa',
  FI: 'Helsinki',
  FJ: 'Suva',
  FR: 'Paris',
  GA: 'Libreville',
  GB: 'London',
  GE: 'Tbilisi',
  GH: 'Accra',
  GM: 'Banjul',
  GN: 'Conakry',
  GQ: 'Malabo',
  GR: 'Athens',
  GT: 'Guatemala City',
  GW: 'Bissau',
  GY: 'Georgetown',
  HN: 'Tegucigalpa',
  HR: 'Zagreb',
  HT: 'Port-au-Prince',
  HU: 'Budapest',
  ID: 'Jakarta',
  IE: 'Dublin',
  IL: 'Jerusalem',
  IN: 'New Delhi',
  IQ: 'Baghdad',
  IR: 'Tehran',
  IS: 'Reykjavik',
  IT: 'Rome',
  JM: 'Kingston',
  JO: 'Amman',
  JP: 'Tokyo',
  KE: 'Nairobi',
  KG: 'Bishkek',
  KH: 'Phnom Penh',
  KI: 'Tarawa',
  KM: 'Moroni',
  KP: 'Pyongyang',
  KR: 'Seoul',
  KW: 'Kuwait City',
  KZ: 'Astana',
  LA: 'Vientiane',
  LB: 'Beirut',
  LI: 'Vaduz',
  LK: 'Colombo',
  LR: 'Monrovia',
  LS: 'Maseru',
  LT: 'Vilnius',
  LU: 'Luxembourg',
  LV: 'Riga',
  LY: 'Tripoli',
  MA: 'Rabat',
  MC: 'Monaco',
  MD: 'Chișinău',
  ME: 'Podgorica',
  MG: 'Antananarivo',
  MK: 'Skopje',
  ML: 'Bamako',
  MM: 'Naypyidaw',
  MN: 'Ulaanbaatar',
  MR: 'Nouakchott',
  MT: 'Valletta',
  MU: 'Port Louis',
  MV: 'Malé',
  MW: 'Lilongwe',
  MX: 'Mexico City',
  MY: 'Kuala Lumpur',
  MZ: 'Maputo',
  NA: 'Windhoek',
  NE: 'Niamey',
  NG: 'Abuja',
  NI: 'Managua',
  NL: 'Amsterdam',
  NO: 'Oslo',
  NP: 'Kathmandu',
  NR: 'Yaren',
  NZ: 'Wellington',
  OM: 'Muscat',
  PA: 'Panama City',
  PE: 'Lima',
  PG: 'Port Moresby',
  PH: 'Manila',
  PK: 'Islamabad',
  PL: 'Warsaw',
  PT: 'Lisbon',
  PW: 'Ngerulmud',
  PY: 'Asunción',
  QA: 'Doha',
  RO: 'Bucharest',
  RS: 'Belgrade',
  RU: 'Moscow',
  RW: 'Kigali',
  SA: 'Riyadh',
  SB: 'Honiara',
  SC: 'Victoria',
  SD: 'Khartoum',
  SE: 'Stockholm',
  SG: 'Singapore',
  SI: 'Ljubljana',
  SK: 'Bratislava',
  SL: 'Freetown',
  SM: 'San Marino',
  SN: 'Dakar',
  SO: 'Mogadishu',
  SR: 'Paramaribo',
  SS: 'Juba',
  ST: 'São Tomé',
  SV: 'San Salvador',
  SY: 'Damascus',
  SZ: 'Mbabane',
  TD: "N'Djamena",
  TG: 'Lomé',
  TH: 'Bangkok',
  TJ: 'Dushanbe',
  TL: 'Dili',
  TM: 'Ashgabat',
  TN: 'Tunis',
  TO: "Nuku'alofa",
  TR: 'Ankara',
  TT: 'Port of Spain',
  TV: 'Funafuti',
  TZ: 'Dodoma',
  UA: 'Kyiv',
  UG: 'Kampala',
  US: 'New York',
  UY: 'Montevideo',
  UZ: 'Tashkent',
  VA: 'Vatican City',
  VC: 'Kingstown',
  VE: 'Caracas',
  VN: 'Hanoi',
  VU: 'Port Vila',
  WS: 'Apia',
  YE: "Sana'a",
  ZA: 'Cape Town',
  ZM: 'Lusaka',
  ZW: 'Harare',
}

const getCityForCountry = (countryCode: string): string => {
  return COUNTRY_CITY_MAP[countryCode.toUpperCase()] ?? countryCode
}

export const fetchCountryIs = async (): Promise<CountryIsResponse> => {
  const response = await fetch(COUNTRY_IS_URL)

  if (!response.ok) {
    throw new Error(`country.is responded with ${response.status}`)
  }

  return response.json() as Promise<CountryIsResponse>
}

export const fetchOpenMeteoGeocoding = async (query: string): Promise<LocationSearchResult> => {
  const params = new URLSearchParams({
    name: query,
    count: '1',
    language: 'en',
    format: 'json',
  })

  const response = await fetch(`${OPEN_METEO_GEOCODING_BASE}?${params}`)

  if (!response.ok) {
    throw new Error(`Open-Meteo geocoding responded with ${response.status}`)
  }

  const data = await (response.json() as Promise<OpenMeteoGeocodingResponse>)
  const result = data.results?.[0]

  if (!result) {
    throw new Error('No geocoding results found')
  }

  const fallbackId = `${result.name.toLowerCase()}-${result.latitude.toFixed(4)}-${result.longitude.toFixed(4)}`

  return {
    id: typeof result.id === 'number' ? String(result.id) : fallbackId,
    name: result.name,
    subtitle: [result.admin1, result.country].filter(Boolean).join(', '),
    latitude: result.latitude,
    longitude: result.longitude,
    timezone: result.timezone ?? null,
  }
}

export const toCoordinateOnlyLocation = (
  latitude: number,
  longitude: number,
): LocationSearchResult => ({
  id: `coords-${latitude.toFixed(4)}-${longitude.toFixed(4)}`,
  name: '',
  subtitle: '',
  latitude,
  longitude,
  timezone: null,
})

export const detectAutoLocation = async (): Promise<LocationSearchResult> => {
  const countryData = await fetchCountryIs()
  const searchQuery = getCityForCountry(countryData.country)
  return fetchOpenMeteoGeocoding(searchQuery)
}

export const createGeoLocationApi = (): GeoLocationApi => ({
  source_name: 'geoLocation',
  errors_fields: [],
  detectLocation: detectAutoLocation,
  detectLocationByCoordinates: ({ latitude, longitude }) =>
    Promise.resolve(toCoordinateOnlyLocation(latitude, longitude)),
})

export function getYandexLink(lat, lon) {
  return `https://yandex.ru/maps/?rtext=~${lat},${lon}`;
}

export function get2gisLink(lat, lon) {
  return `https://2gis.kz/almaty/routeSearch/rsType/car/to/${lon},${lat}`;
}
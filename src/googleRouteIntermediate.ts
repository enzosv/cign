import { Coordinate, IntermediateDuration } from '.';

interface DurationRequest {
	origin: Waypoint;
	destination: Waypoint;
	intermediates: Waypoint[];
	travelMode: string;
	routingPreference: string;
}

interface RouteResponse {
	routes: Route[];
}

interface Route {
	legs: Leg[];
}

interface Leg {
	duration: string;
}

interface Waypoint {
	location: Location;
}

interface Location {
	latLng: Coordinate;
}

/**
 * Uses google computeRoutes API to estimate travel time of a route
 * https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRoutes
 * @param route the object containing origin and destination coordinates
 * @throws {Error} If something goes wrong.
 * @returns {number} duration of route in seconds
 */
export async function fetchIntermediateDuration(key: string, coordinates: Coordinate[]): Promise<IntermediateDuration[]> {
	const body = JSON.stringify(convertCoordinatesToRequest(coordinates));
	const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
		method: 'POST',
		headers: {
			'content-type': 'application/json; application/json',
			'X-Goog-Api-Key': key,
			'X-Goog-FieldMask': 'routes.legs.duration',

			// 'routes.legs.duration,routes.polyline.encodedPolyline,routes.legs.polyline.encodedPolyline,routes.legs.travelAdvisory.speedReadingIntervals,routes.travelAdvisory.speedReadingIntervals', // TODO: get leg start and end coordinates
		},
		body: body,
	});

	const data = await response.json();
	if (!response.ok) {
		throw data;
	}
	// TODO: parse leg start and end coordinates
	const route = (data as RouteResponse).routes[0];
	return route.legs.map((leg) => {
		return {
			// start: { longitude: 0, latitude: 0 },
			// end: { longitude: 0, latitude: 0 },
			duration: parseInt(leg.duration),
		};
	});
}

function convertCoordinatesToRequest(coordinates: Coordinate[]): DurationRequest {
	if (coordinates.length < 2) {
		throw new Error('insufficient coordinates');
	}

	const places = coordinates.map(function (coordinate) {
		return {
			location: {
				latLng: coordinate,
			},
		};
	});
	let intermediates: Waypoint[] = [];
	if (coordinates.length > 2) {
		intermediates = [...places];
		intermediates.shift(); // remove origin from intermediate
		intermediates.pop(); // remove destination from intermediate
	}

	return {
		travelMode: 'DRIVE',
		routingPreference: 'TRAFFIC_AWARE_OPTIMAL',
		origin: places[0],
		destination: places[places.length - 1],
		intermediates: intermediates,
	};
}

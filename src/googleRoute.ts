import { Coordinate } from '.';

interface DurationRequest {
	origin: Waypoint;
	destination: Waypoint;
	travelMode: string;
	routingPreference: string;
}

interface DurationResponse {
	routes: DurationRoute[];
}

interface DurationRoute {
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
export async function fetchDuration(key: string, origin: Coordinate, destination: Coordinate): Promise<number> {
	const body = JSON.stringify(convertRouteToRequest(origin, destination));
	// TODO: limit to 20k/month ~ 26/hour
	const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
		method: 'POST',
		headers: {
			'content-type': 'application/json; application/json',
			'X-Goog-Api-Key': key,
			'X-Goog-FieldMask': 'routes.duration',
		},
		body: body,
	});

	const data = await response.json();
	// console.log(JSON.stringify(data));
	if (!response.ok) {
		throw data;
	}

	const durationString = (data as DurationResponse).routes[0].duration;
	return parseInt(durationString); //stops at first non number ('s')
}

function convertRouteToRequest(origin: Coordinate, destination: Coordinate): DurationRequest {
	return {
		travelMode: 'DRIVE',
		routingPreference: 'TRAFFIC_AWARE_OPTIMAL',
		origin: {
			location: {
				latLng: origin,
			},
		},
		destination: {
			location: {
				latLng: destination,
			},
		},
	};
}

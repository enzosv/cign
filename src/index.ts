/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.json`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import {
	detailGroupEstimates,
	detailRoute,
	listPlaces,
	listRoutes,
	queryRouteGroup,
	saveEstimate,
	saveGroupEstimate,
	saveStaticDuration,
	summarizeGroupEstimates,
} from './d1';
import { fetchDuration } from './googleRoute';
import { fetchIntermediateDuration } from './googleRouteIntermediate';
export interface Env {
	// If you set another name in the Wrangler config file for the value for 'binding',
	// replace "DB" with the variable name you defined.
	DB: D1Database;
	API_KEY: string;
	ASSETS: string;
}

export interface Coordinate {
	longitude: number;
	latitude: number;
}

export interface Place {
	place_id: number;
	longitude: number;
	latitude: number;
	route_group: number;
	route_order: number;
	static_duration: number;
}

export interface Route {
	route_id: number;
	origin: Coordinate;
	destination: Coordinate;
	latest_estimate: string;
}

export interface IntermediateDuration {
	// start: Coordinate;
	// end: Coordinate;
	duration: number;
	staticDuration: number;
}

export default {
	async scheduled(event: any, env: Env, ctx: ExecutionContext) {
		await Promise.all([
			estimateRoutes(env),
			estimateIntermediate(env, [0]), //edsa sb
			estimateIntermediate(env, [1]), // edsa nb
			estimateIntermediate(env, [2, 3]), // ortigas eb,wb
		]);
		try {
			const cache = caches.default;
			cache.delete('https://cign.enzosv.workers.dev/api/estimates');
			cache.delete('https://cign.enzosv.workers.dev/api/estimates/historical');
		} catch (error) {
			console.error('unable to clear cache', error);
		}
	},
	async fetch(request, env, ctx): Promise<Response> {
		// await Promise.all([
		// estimateRoutes(env),
		// estimateIntermediate(env, [0]), //edsa sb
		// estimateIntermediate(env, [1]), // edsa nb
		// 	estimateIntermediate(env, [2, 3]), // ortigas eb,wb
		// ]);

		const url = new URL(request.url);
		const cache = caches.default;
		const cached = await cache.match(url);
		if (cached) {
			return cached;
		}

		if (!url.pathname.startsWith('/api/')) {
			return new Response('{"error":"404"}');
		}

		const data = await handleJSONRequest(url, env);

		const response = new Response(JSON.stringify(data));
		response.headers.set('Content-Type', 'application/json');
		response.headers.set('Cache-Control', 'max-age=300');
		if (url.pathname == '/api/places') {
			response.headers.set('Cache-Control', 'max-age=86400');
		}
		ctx.waitUntil(cache.put(url, response.clone()));
		return response;
	},
} satisfies ExportedHandler<Env>;

async function handleJSONRequest(url: URL, env: Env) {
	if (url.pathname == '/api/estimates') {
		const estimates = await summarizeGroupEstimates(env.DB);
		return { estimates: estimates.results };
	}
	if (url.pathname == '/api/estimates/historical') {
		const params = url.searchParams;
		const origin = parseInt(params.get('origin') ?? '');
		if (isNaN(origin)) {
			return { error: 'origin must be a number' };
		}
		const destination = parseInt(params.get('destination') ?? '');
		if (isNaN(destination)) {
			return { error: 'destination must be a number' };
		}
		const group = parseInt(params.get('group') ?? '');
		if (isNaN(group)) {
			return { error: 'group must be a number' };
		}
		const estimates = await detailGroupEstimates(env.DB, group, origin, destination);
		return { estimates: estimates.results };
	}
	if (url.pathname == '/api/places') {
		const places = await listPlaces(env.DB);
		return { places: places };
	}
	if (url.pathname == '/api/route') {
		const params = url.searchParams;
		const origin = parseInt(params.get('origin') ?? '');
		if (isNaN(origin)) {
			return { error: 'origin must be a number' };
		}
		const destination = parseInt(params.get('destination') ?? '');
		if (isNaN(destination)) {
			return { error: 'destination must be a number' };
		}
		const route = await detailRoute(env.DB, origin, destination);
		return route.results;
	}

	return { error: 404 };
}

/**
 * Determines if a given date is within the last two minutes.
 * @param {Date} date - The date to be checked.
 * @returns {boolean} - Returns true if the date is within the last two
minutes, otherwise false.
 */
function isRecent(date: Date) {
	const now = new Date();
	const dif = now.getTime() - date.getTime();
	return dif < 2 * 60 * 1000; // 2 minutes
}

async function getRoutes(env: Env) {
	const cache = caches.default;
	const cacheKey = `http://listRoutes`;
	const cached = await cache.match(cacheKey);
	if (cached) {
		const routes = (await cached.json()) as unknown as Route[];
		return routes;
	}

	const routes = await listRoutes(env.DB);
	const response = new Response(JSON.stringify(routes));
	response.headers.append('Cache-Control', 'max-age=86400');
	await cache.put(cacheKey, response);
	return routes;
}

async function estimateRoutes(env: Env) {
	const routes = await getRoutes(env);
	const promises = [];
	for (const route of routes) {
		// if last estimate was within 2m, ignore
		if (isRecent(new Date(route.latest_estimate))) {
			return;
		}
		promises.push(
			fetchDuration(env.API_KEY, route.origin, route.destination).then((duration) => {
				saveEstimate(env.DB, route.route_id, duration);
			})
		);
	}
	await Promise.all(promises);
}

async function getIntermediates(env: Env, group: number) {
	// get from cache
	const cache = caches.default;
	const cacheKey = `http://queryRouteGroup/${group}`;
	const cached = await cache.match(cacheKey);
	if (cached) {
		return (await cached.json()) as unknown as Place[];
	}

	// not in cache
	const places = await queryRouteGroup(env.DB, group);

	// save to cache
	const response = new Response(JSON.stringify(places));
	response.headers.append('Cache-Control', 'max-age=86400');
	await cache.put(cacheKey, response);
	return places;
}

async function estimateIntermediate(env: Env, groups: number[]) {
	const placePromises = [];
	// TODO: either combine group number and sort key into object or assert that they are same length
	for (let i = 0; i < groups.length; i++) {
		placePromises.push(getIntermediates(env, groups[i]));
	}
	const places = (await Promise.all(placePromises)).flat(1);

	const coordinates = places.map((place) => {
		return { longitude: place.longitude, latitude: place.latitude };
	});
	const durations = await fetchIntermediateDuration(env.API_KEY, coordinates);
	const date = new Date();
	// assumes first duration is for coordinate[0]->coordinate[1] and so on
	// TODO: get leg start and end coordinates, map to place
	const promises = [];
	for (let i = 0; i < durations.length; i++) {
		const origin = places[i];
		const destination = places[i + 1];
		// console.log(origin, destination);
		if (!origin.static_duration) {
			promises.push(saveStaticDuration(env.DB, origin.place_id, durations[i].staticDuration));
		}
		if (origin.route_group != destination.route_group) {
			// for roundtrips, do not save from one end to another
			// In ddd, this should be in saveGroupEstimate func
			continue;
		}
		promises.push(saveGroupEstimate(env.DB, origin.place_id, destination.place_id, durations[i].duration, date));
	}
	await Promise.all(promises);
}

import { Place, Route } from '.';

interface RouteQueryResult {
	route_id: number;
	origin_lon: number;
	origin_lat: number;
	dest_lon: number;
	dest_lat: number;
	latest_estimate: string | null;
}
export async function initDB(db: D1Database): Promise<D1Result<unknown>[]> {
	const places = db.prepare(`CREATE TABLE IF NOT EXISTS "places" (
            place_id INTEGER PRIMARY KEY,
            google_place_id TEXT UNIQUE, 
            lon REAL, 
            lat REAL, 
			address TEXT,
			static_duration INTEGER, -- duration to next place at route_order + 1
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL, 
            updated_at TIMESTAMP,
			route_order INTEGER,
			route_group INTEGER -- 0 edsa_sb, 1 edsa_nb
        );`);
	const places_index = db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS places_uq_coordinates ON places(lon, lat);`);
	const routes = db.prepare(`CREATE TABLE IF NOT EXISTS "routes" (
            route_id INTEGER PRIMARY KEY,
            origin INTEGER NOT NULL REFERENCES places(place_id) ON UPDATE CASCADE, 
            destination INTEGER NOT NULL REFERENCES places(place_id) ON UPDATE CASCADE, 
            name TEXT NOT NULL,
            start_time REAL NOT NULL DEFAULT 0,
            end_time REAL NOT NULL DEFAULT 1440,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL, 
            updated_at TIMESTAMP
        );`);
	const estimates = db.prepare(`CREATE TABLE IF NOT EXISTS "estimates" (
            estimate_id INTEGER PRIMARY KEY,
            route_id INTEGER NOT NULL REFERENCES routes(route_id) ON UPDATE CASCADE,
            duration INTEGER NOT NULL, 
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
        );`);
	const group_estimates = db.prepare(`CREATE TABLE IF NOT EXISTS "group_estimates" (
            estimate_id INTEGER PRIMARY KEY,
            origin INTEGER NOT NULL REFERENCES places(place_id) ON UPDATE CASCADE,
            destination INTEGER NOT NULL REFERENCES places(place_id) ON UPDATE CASCADE, 
            duration INTEGER NOT NULL, 
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
        );`);
	// const latest_estimates = db.prepare(`CREATE VIEW IF NOT EXISTS "latest_estimates" AS
	// 	SELECT route_id, MAX(created_at) latest_estimate
	// 	FROM estimates
	// 	GROUP BY route_id
	// 	;`);

	return db.batch([db.prepare(`PRAGMA foreign_keys = 1;`), places, places_index, routes, estimates, group_estimates]);
}

export async function saveGroupEstimate(db: D1Database, origin_id: number, destination_id: number, duration: number, date: Date) {
	return db
		.prepare(
			`INSERT INTO group_estimates (origin, destination, duration, created_at)
      VALUES (?, ?, ?, datetime(?))
      ON CONFLICT DO NOTHING;`
		)
		.bind(origin_id, destination_id, duration, date.toISOString())
		.run();
}

export async function saveStaticDuration(db: D1Database, place_id: number, static_duration: number) {
	return db.prepare(`UPDATE places SET static_duration=? WHERE place_id = ?;`).bind(static_duration, place_id).run();
}

export async function saveEstimate(db: D1Database, route_id: number, duration: number) {
	return db
		.prepare(
			`INSERT INTO estimates (route_id, duration)
      VALUES (?, ?)
      ON CONFLICT DO NOTHING
      RETURNING duration;`
		)
		.bind(route_id, duration)
		.first();
}

export async function queryRoute(db: D1Database, route_id: number): Promise<Route | null> {
	const result = await db
		.prepare(
			`SELECT r.route_id, o.lon origin_lon, o.lat origin_lat, d.lon dest_lon, d.lat dest_lat, MAX(e.created_at)
      FROM routes r
      JOIN places o ON (o.place_id = r.origin)
      JOIN places d ON (d.place_id = r.destination)
	  LEFT OUTER JOIN estimates e USING (route_id)
      WHERE r.route_id = ?
	  GROUP BY r.route_id
	  ;`
		)
		.bind(route_id)
		.first<RouteQueryResult>();
	if (!result) {
		return null;
	}
	return {
		origin: { longitude: result.origin_lon, latitude: result.origin_lat },
		destination: { longitude: result.dest_lon, latitude: result.dest_lat },
		route_id: result.route_id,
		latest_estimate: result.latest_estimate ?? '0',
	};
}

export async function listPlaces(db: D1Database): Promise<Place[]> {
	const results = await db
		.prepare(
			`SELECT place_id, address, lon longitude, lat latitude, route_group, route_order
		FROM places 
		WHERE route_group IS NOT NULL --those without route group are private
		ORDER BY route_group, route_order;`
		)
		.all<Place>();
	return results.results;
}

export async function listRoutes(db: D1Database): Promise<Route[]> {
	const results = await db
		.prepare(
			`SELECT r.route_id, o.lon origin_lon, o.lat origin_lat, d.lon dest_lon, d.lat dest_lat, MAX(e.created_at)
				FROM routes r
				JOIN places o ON (o.place_id = r.origin)
				JOIN places d ON (d.place_id = r.destination)
				LEFT OUTER JOIN estimates e USING (route_id)
	 			GROUP BY r.route_id;`
		)
		.all<RouteQueryResult>();
	return results.results.map((result) => {
		return {
			origin: { longitude: result.origin_lon, latitude: result.origin_lat },
			destination: { longitude: result.dest_lon, latitude: result.dest_lat },
			route_id: result.route_id,
			latest_estimate: result.latest_estimate ?? '0',
		};
	});
}

/**
 * query places for intermediate route fetch
 * @param db the database driver
 * @param group 0: edsa_sb, 1: edsa_nb, 2: ortigas_wb, 3: ortigas_eb
 * @returns
 */
export async function queryRouteGroup(db: D1Database, group: number) {
	const query = await db
		.prepare(
			`
		SELECT
			place_id, lon longitude, lat latitude, route_group, static_duration
		FROM places 
		WHERE route_group=?
		ORDER BY route_order;`
		)
		.bind(group)
		.all<Place>();
	return query.results;
}

/**
 * List current estimates for all grouped routes
 * @param db
 * @returns
 */
export async function summarizeGroupEstimates(db: D1Database) {
	return db
		.prepare(
			`SELECT ge.origin, ge.destination, ge.duration, ge.created_at
			FROM group_estimates ge
			JOIN (
				SELECT origin, destination, MAX(created_at) AS latest_created_at
				FROM group_estimates
				GROUP BY origin, destination
			) latest
			ON ge.origin = latest.origin 
			AND ge.destination = latest.destination 
			AND ge.created_at = latest.latest_created_at;`
		)
		.all();
}

/**
 * list estimates today, yesterday, last week
 * estimates of the day are +/- 1hr of the current time
 * @param db
 * @param route_group
 * @param origin
 * @param destination
 * @param date
 * @returns
 */
export async function detailGroupEstimates(db: D1Database, route_group: number, origin: number, destination: number, date?: Date) {
	// If no date is provided, use the current date/time
	if (!date) {
		date = new Date();
	}

	// TODO: ensure origin and destination are same group

	return db
		.prepare(
			`
			WITH 
				input AS (SELECT ? AS date),
				p AS (
					SELECT place_id 
					FROM places 
					WHERE route_group=?
					AND route_order>=(SELECT route_order FROM places WHERE place_id=?) 
					AND route_order<(SELECT route_order FROM places WHERE place_id=?)
				)
			SELECT sum(e.duration) duration, substr(e.created_at, 0, 17) created_at  
			FROM group_estimates e
			CROSS JOIN input
			WHERE origin IN p
			AND (
				(
					e.created_at BETWEEN (datetime(date, '-1 hours'))
					AND (datetime(date, '+1 hours'))
		  		)  OR
				(
					e.created_at BETWEEN (datetime(date, '-25 hours'))
					AND (datetime(date, '-23 hours'))
				) OR
				(
					e.created_at BETWEEN (datetime(date, '-169 hours'))
					AND (datetime(date, '-167 hours'))
				)
			)
			GROUP BY substr(e.created_at, 0, 17)  -- 17 to group to minute -- duration will be inflated if multiple estimates were saved within the minute
			ORDER BY e.created_at;`
		)
		.bind(date.toISOString(), route_group, origin, destination)
		.all();
}

/**
 * List estimates for a route
 * @param db
 * @param route_id
 * @param date
 * @returns
 */
export async function listEstimates(db: D1Database, route_id: number, date?: Date) {
	// If no date is provided, use the current date/time
	if (!date) {
		date = new Date();
	}
	return db
		.prepare(
			`
			WITH input AS (SELECT ? AS date)
			SELECT e.duration, e.created_at
			FROM estimates e 
			CROSS JOIN input
			WHERE e.route_id = ?
			AND (
				(
					e.created_at BETWEEN (datetime(date, '-2 hours'))
					AND (datetime(date, '+2 hours'))
		  		)  OR
				(
					e.created_at BETWEEN (datetime(date, '-26 hours'))
					AND (datetime(date, '-22 hours'))
				) OR
				(
					e.created_at BETWEEN (datetime(date, '-170 hours'))
					AND (datetime(date, '-166 hours'))
				)
			)
			;`
		)
		.bind(date.toISOString(), route_id)
		.all();
}

/**
 * fix route_order of places
 * EDSA Southbound	lat DESC
 * EDSA Northbound	lat
 * Ortigas Eastbound	lon
 * Ortigas Westbound	lon DESC
 * @param route_group 0: edsa_sb, 1: edsa_nb, 2: ortigas_wb, 3: ortigas_eb
 * @param sort more lon=more south, more lat=more west
 */
async function fixOrder(route_group: number, sort: string) {
	const query = `
	UPDATE places
	SET route_order = x.ROW_ID
	FROM (
		SELECT place_id, ROW_NUMBER() OVER (ORDER BY ${sort}) AS ROW_ID
		FROM places
		WHERE route_group=?) AS x
	WHERE places.place_id = x.place_id;`;
}

async function deleteDuplicateEstimates() {
	const query = `
		delete from group_estimates where estimate_id not in (
 select estimate_id -- same as min(estimate_id)??
  from group_estimates
  group by origin, destination, substr(created_at, 0, 17) -- same origin, destination, minute
  order by estimate_id);`;
}

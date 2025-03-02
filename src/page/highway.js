const ROUTE_GROUPS = { 0: 'EDSA Southbound', 1: 'EDSA Northbound', 2: 'Ortigas Eastbound', 3: 'Ortigas Westbound' };
let origin = null;

async function main() {
	const [placesResponse, estimatesResponse] = await Promise.all([fetch('/api/places'), fetch('/api/estimates')]);
	const [places, estimates] = await Promise.all([placesResponse.json(), estimatesResponse.json()]);
	const groupedPlaces = groupPlaces(places.places);
	moment.updateLocale('en', {
		relativeTime: {
			future: 'in %s',
			past: '%s ago',
			s: '1 min',
			m: '1 min',
			mm: '%d mins',
			h: '1 hr',
			hh: '%d hrs',
		},
	});
	const groups = groupEstimates(groupedPlaces, estimates);
	// console.log(groups);

	createTable(groups);
}

main();

function groupPlaces(places) {
	const groups = {};
	for (const place of places) {
		if (!groups.hasOwnProperty(place.route_group)) {
			groups[place.route_group] = [];
		}
		groups[place.route_group].push(place);
	}
	return groups;
}

function groupEstimates(places, estimates) {
	const groups = {};
	for (const gp_key in places) {
		const groupedPlace = places[gp_key];
		for (const place of groupedPlace) {
			for (const estimate of estimates.estimates) {
				if (estimate.origin != place.place_id) {
					continue;
				}

				if (!groupedPlace.some((f) => f.place_id == estimate.destination)) {
					// destination is different group. ignore
					continue;
				}

				const group = place.route_group;
				if (!groups.hasOwnProperty(group)) {
					groups[group] = { name: ROUTE_GROUPS[group], cells: [], last_check: moment.utc(estimate.created_at).fromNow() };
				}
				let duration = moment.duration(estimate.duration, 'seconds').humanize();
				let color = '#47A025';
				if (place.static_duration) {
					const dif = estimate.duration - place.static_duration;
					// TODO: make color gradient from green to yellow to red depending on dif
					if (dif > 60) {
						color = '#E6AF2E';
						// duration += ` (+${moment.duration(dif, 'seconds').humanize()})`;
						if (dif > 300) {
							color = '#780116';
						}
					}
				}
				groups[group].cells.push({
					id: place.place_id,
					group: place.route_group,
					name: place.address,
					route_order: place.route_order,
					duration: duration,
					color: color,
				});
				break;
			}
		}
		const last_place = groupedPlace[groupedPlace.length - 1];
		groups[gp_key].cells.push({
			id: last_place.place_id,
			group: last_place.route_group,
			name: last_place.address,
			route_order: last_place.route_order,
		});
	}
	return groups;
}

function createTable(groups) {
	const container = document.getElementById('station-container');
	container.innerHTML = '';
	for (const key in groups) {
		const group = groups[key];
		const data = group.cells;

		// Create title
		const titleContainer = document.createElement('div');
		titleContainer.style = 'margin-top: 32px; margin-bottom: 24px';
		const title = document.createElement('h2');
		title.style = 'margin-bottom: 2px';
		title.textContent = group.name;
		const subtitle = document.createElement('small');
		subtitle.style = 'display: block; margin-top: 0;';
		subtitle.textContent = 'Updated ' + group.last_check;

		titleContainer.appendChild(title);
		titleContainer.appendChild(subtitle);

		container.appendChild(titleContainer);

		data.forEach((rowData) => {
			// console.log(rowData);
			const station = document.createElement('div');
			station.classList.add('station');
			const label = document.createElement('p');
			label.textContent = rowData.name;

			station.appendChild(label);
			const sub = document.createElement('small');
			sub.textContent = 'Set as origin';
			if (origin && rowData.id == origin.id) {
				sub.innerHTML = 'Clear origin';
			} else if (origin && rowData.group == origin.group && rowData.route_order > origin.route_order) {
				sub.innerHTML = 'Set as destination';
			}
			// sub.style = 'float: right;';
			station.onclick = function () {
				cellClick(rowData);
				createTable(groups);
			};
			station.appendChild(sub);

			container.appendChild(station);
			if (!rowData.duration) {
				return;
			}
			const road = document.createElement('div');
			road.classList.add('road');
			road.style = `background-color: ${rowData.color}`;
			const timeBubble = document.createElement('div');
			timeBubble.textContent = rowData.duration;
			timeBubble.classList.add('time-bubble');
			road.appendChild(timeBubble);
			container.appendChild(road);
		});
	}
}

function cellClick(place) {
	if (!origin || origin.group != place.group || place.route_order < origin.route_order) {
		origin = place;
		return;
	}
	if (origin.id == place.id) {
		origin = null;
		return;
	}
	// console.log(origin, place);
	// redirect
	window.location.href = `/detail?origin=${origin.id}&destination=${place.id}`;
}

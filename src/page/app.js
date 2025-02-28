const ROUTE_GROUPS = { 0: 'EDSA Southbound', 1: 'EDSA Northbound', 2: 'Ortigas Eastbound', 3: 'Ortigas Westbound' };

let origin = null;

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
				let color = 'green';
				if (place.static_duration) {
					const dif = estimate.duration - place.static_duration;
					// TODO: make color gradient from green to yellow to red depending on dif
					if (dif > 60) {
						color = 'yellow';
						duration += ` (+${moment.duration(dif, 'seconds').humanize()})`;
						if (dif > 300) {
							color = 'red';
						}
					}
				}
				groups[group].cells.push([
					{ text: duration, color: color },
					{ id: place.place_id, group: place.route_group, name: place.address, route_order: place.route_order },
				]);
				break;
			}
		}
		const last_place = groupedPlace[groupedPlace.length - 1];
		groups[gp_key].cells.push([
			null,
			{ id: last_place.place_id, group: last_place.route_group, name: last_place.address, route_order: last_place.route_order },
		]);
	}
	return groups;
}

function createTable(groups) {
	const container = document.getElementById('tables-container');
	container.innerHTML = '';
	for (const key in groups) {
		const group = groups[key];
		// Create a wrapper div for each table
		const tableContainer = document.createElement('div');
		tableContainer.classList.add('table-container');

		// Create title
		const titleContainer = document.createElement('div');
		const title = document.createElement('h2');
		title.style = 'margin-bottom: 2px';
		title.textContent = group.name;
		const subtitle = document.createElement('small');
		subtitle.style = 'display: block; margin-top: 0;';
		subtitle.textContent = 'Updated ' + group.last_check;
		titleContainer.appendChild(title);
		titleContainer.appendChild(subtitle);
		tableContainer.appendChild(titleContainer);

		// Create table
		const table = document.createElement('table');

		// Create table header
		const thead = document.createElement('thead');
		const headerRow = document.createElement('tr');
		const headers = ['Estimate', 'Place'];
		for (const header of headers) {
			const th = document.createElement('th');
			th.textContent = header;
			headerRow.appendChild(th);
		}
		thead.appendChild(headerRow);
		table.appendChild(thead);

		// Create table body
		const tbody = document.createElement('tbody');
		const data = group.cells;
		data.forEach((rowData) => {
			const row = document.createElement('tr');
			for (let i = 0; i < rowData.length; i++) {
				const cell = document.createElement('td');
				if (i == 0) {
					if (!rowData[i]) {
						cell.style = 'border: none';
					} else {
						cell.classList.add('offset');
						cell.textContent = rowData[i].text;
						cell.style = `color:black; background-color: ${rowData[i].color}`;
					}
				} else {
					const place = rowData[i];
					cell.textContent = place.name;

					const label = document.createElement('sub');
					label.textContent = 'Set as origin';
					if (origin && place.id == origin.id) {
						label.textContent = 'Clear origin';
					} else if (origin && place.group == origin.group && place.route_order > origin.route_order) {
						label.textContent = 'Set as destination';
					}
					label.style = 'float: right;';
					cell.onclick = function () {
						cellClick(rowData[i]);
						createTable(groups);
					};
					cell.appendChild(label);
				}

				row.appendChild(cell);
			}
			tbody.appendChild(row);
		});
		table.appendChild(tbody);

		// Append table to container
		tableContainer.appendChild(table);

		container.appendChild(tableContainer);
	}
}
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

	// console.log(estimates.estimates);
	// console.log(groupedPlaces);
	const groups = groupEstimates(groupedPlaces, estimates);
	createTable(groups);
}
main();

function cellClick(place) {
	if (!origin || origin.group != place.group || place.route_order < origin.route_order) {
		origin = place;
		return;
	}
	if (origin.id == place.id) {
		origin = null;
		return;
	}
	// redirect
	window.location.href = `/detail?origin=${origin.id}&destination=${place.id}`;
}

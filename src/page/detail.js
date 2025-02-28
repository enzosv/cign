async function fetchRoute(origin, destination) {
	const response = await fetch(`/api/route?origin=${origin}&destination=${destination}`);
	return response.json();
}
async function fetchEstimates(origin, destination, group) {
	const response = await fetch(`/api/estimates/historical?origin=${origin}&destination=${destination}&group=${group}`);
	return response.json();
	// return {
	// 	estimates: [
	// 		{ duration: 1539, created_at: '2025-02-20 16:00' },
	// 		{ duration: 546, created_at: '2025-02-20 15:40' },
	// 		{ duration: 498, created_at: '2025-02-19 17:00' },
	// 		{ duration: 501, created_at: '2025-02-19 16:45' },
	// 		{ duration: 556, created_at: '2025-02-19 16:00' },
	// 		{ duration: 557, created_at: '2025-02-19 15:40' },
	// 		{ duration: 542, created_at: '2025-02-13 17:00' },
	// 		{ duration: 533, created_at: '2025-02-13 16:45' },
	// 		{ duration: 548, created_at: '2025-02-13 16:00' },
	// 		{ duration: 589, created_at: '2025-02-13 15:40' },
	// 	],
	// };
}

/**
 * group estimates into 4 hour groups
 * group by time, not day, to prevent misgroupings when requested time is 12am
 * @param {*} data
 * @param {number} maxGapHours
 * @returns
 */
function groupEstimatesByTime(data, maxGapHours = 4) {
	const timeKeys = {};
	const estimates = data.estimates
		.map((e) => {
			return {
				...e,
				created_at: new Date(e.created_at + 'Z'), // convert to utc date
			};
		})
		.sort((a, b) => a.created_at - b.created_at);

	const groups = [];
	let currentGroup = {};
	let groupStart = null;

	for (const estimate of estimates) {
		const hour = estimate.created_at.getHours();
		const minutes = Math.floor(estimate.created_at.getMinutes() / 15) * 15;
		const timeKey = `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
		timeKeys[timeKey] = 0;

		if (!groupStart || (estimate.created_at - groupStart) / (1000 * 60 * 60) <= maxGapHours) {
			// first or within current group
			currentGroup[timeKey] = estimate.duration;
		} else {
			// out of time range. create new group
			groups.push(currentGroup);
			currentGroup = {};
			currentGroup[timeKey] = estimate.duration;
		}
		groupStart = estimate.created_at;
	}
	groups.push(currentGroup);
	// insert timekeys to keep charts visually consistent
	for (const time in timeKeys) {
		for (const group in groups) {
			if (!groups[group][time]) {
				groups[group][time] = 0;
			}
		}
	}
	// sort newly inserted timekeys
	for (const group in groups) {
		groups[group] = Object.keys(groups[group])
			.sort()
			.reduce(function (acc, key) {
				acc[key] = groups[group][key];
				return acc;
			}, {});
	}
	return [groups, timeKeys];
}

function createChart(groups, timeKeys) {
	const data = {
		labels: Object.keys(timeKeys),
		datasets: [],
	};

	const colors = ['rgba(183, 109, 104, 0.2)', 'rgba(191, 174, 72, 0.2)', 'rgba(75, 192, 192, 0.2)'];
	const borderColors = ['rgb(183, 109, 104)', 'rgb(191, 174, 72)', 'rgb(75, 192, 192)'];
	const labels = ['Last Week', 'Yesterday', 'Today'];
	Object.entries(groups).forEach(([date, timeData], index) => {
		data.datasets.push({
			label: labels[index],
			data: Object.values(timeData),
			backgroundColor: colors[index],
			borderColor: borderColors[index],
			borderWidth: 1,
		});
	});
	const container = document.getElementById('charts-container');

	const canvas = document.createElement('canvas');
	canvas.id = 'chart';
	container.appendChild(canvas);
	const ctx = canvas.getContext('2d');
	new Chart(ctx, {
		type: 'bar',
		data: data,
		options: {
			plugins: {
				tooltip: {
					callbacks: {
						label: function (context) {
							if (context.raw == 0) {
								return '';
							}
							const duration = Math.round(moment.duration(context.raw, 'seconds').asMinutes());
							return `${duration} mins`;
						},
					},
				},
			},
			responsive: true,
			maintainAspectRatio: false,
			interaction: {
				intersect: false,
			},
			scales: {
				y: {
					beginAtZero: true,
					ticks: {
						callback: function (value, index, ticks) {
							if (index % 2 === 0) {
								return '';
							}
							const duration = Math.round(moment.duration(value, 'seconds').asMinutes());
							return `${duration} mins`;
						},
					},
				},
			},
		},
	});
}

async function main() {
	const queryString = window.location.search;
	const urlParams = new URLSearchParams(queryString);
	// TODO: fetch title and group from origin, destination

	const route = await fetchRoute(urlParams.get('origin'), urlParams.get('destination'));

	document.getElementById('title').innerHTML = `${route.origin} to ${route.destination} via ${route.name}`;

	const data = await fetchEstimates(urlParams.get('origin'), urlParams.get('destination'), route.route_group);

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

	const latest = data.estimates[data.estimates.length - 1];
	let duration = moment.duration(latest.duration, 'seconds').humanize();
	const dif = latest.duration - route.static_duration;
	if (dif > 60) {
		duration += ` (+${moment.duration(dif, 'seconds').humanize()})`;
	}
	document.getElementById('summary').innerHTML = `ETA: ${duration} <small>(${moment.utc(latest.created_at).fromNow()})</small>`;
	const [groupedData, timeKeys] = groupEstimatesByTime(data);

	// const [groupedData, timeKeys] = groupDataByDate(data);
	createChart(groupedData, timeKeys);
}

main();

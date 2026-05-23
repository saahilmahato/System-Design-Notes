export type Topic = {
	title: string;
	children?: Topic[];
};

export const topics: Topic[] = [
	{
		title: 'Introduction'
	},
	{
		title: 'Scalability',
		children: [
			{
				title: 'Horizontal Scaling'
			},
			{
				title: 'Vertical Scaling'
			},
			{
				title: 'Load Balancing'
			}
		]
	},
	{
		title: 'Databases',
		children: [
			{
				title: 'SQL'
			},
			{
				title: 'NoSQL'
			},
			{
				title: 'Replication'
			},
			{
				title: 'Sharding'
			}
		]
	},
	{
		title: 'Caching',
		children: [
			{
				title: 'Redis'
			},
			{
				title: 'CDN'
			},
			{
				title: 'Cache Invalidation'
			}
		]
	},
	{
		title: 'Messaging',
		children: [
			{
				title: 'Kafka'
			},
			{
				title: 'RabbitMQ'
			}
		]
	},
	{
		title: 'System Design Interviews'
	}
];
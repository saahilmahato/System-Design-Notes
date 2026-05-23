<script lang="ts">
	import { page } from '$app/state';

	import { topics } from '$lib/data/topics';
	import { slugify } from '$lib/utils/slug';

	function path(title: string) {
		return `/${slugify(title)}`;
	}

	function isActive(title: string) {
		return page.url.pathname === path(title);
	}
</script>

<nav>
	<ul class="toc">
		{#each topics as topic (topic.title)}
			<li>
				<a
					href={path(topic.title)}
					class:active={isActive(topic.title)}
				>
					{topic.title}
				</a>

				{#if topic.children}
					<ul>
						{#each topic.children as child (child.title)}
							<li>
								<a
									href={path(child.title)}
									class:active={isActive(child.title)}
								>
									{child.title}
								</a>
							</li>
						{/each}
					</ul>
				{/if}
			</li>
		{/each}
	</ul>
</nav>

<style>
	.toc,
	.toc ul {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.toc ul {
		margin-left: 1rem;
		padding-left: 0.75rem;
		border-left: 1px solid #222938;
	}

	a {
		display: block;
		padding: 0.55rem 0.75rem;
		border-radius: 10px;
		color: #d7dcea;
		text-decoration: none;
		margin: 0.2rem 0;
		transition:
			background 120ms ease,
			color 120ms ease;
	}

	a:hover {
		background: #1a2130;
		color: white;
	}

	.active {
		background: #20293a;
		color: white;
	}
</style>

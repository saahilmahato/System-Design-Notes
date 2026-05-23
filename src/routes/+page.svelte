<script lang="ts">
	type TocItem = {
		title: string;
		href: string;
		children?: TocItem[];
	};

	const toc: TocItem[] = [
		{
			title: 'Introduction',
			href: '#introduction'
		},
		{
			title: 'Getting Started',
			href: '#getting-started',
			children: [
				{
					title: 'Installation',
					href: '#installation'
				},
				{
					title: 'Folder Structure',
					href: '#folder-structure'
				}
			]
		},
		{
			title: 'Advanced',
			href: '#advanced',
			children: [
				{
					title: 'Rendering',
					href: '#rendering'
				},
				{
					title: 'Deployment',
					href: '#deployment'
				}
			]
		}
	];
</script>

<svelte:head>
	<title>System Design notes</title>
</svelte:head>

<div class="app">
	<header class="topbar">
		<div class="brand">
			<span class="logo">✦</span>
			<span>Notes</span>
		</div>

		<input
			class="search"
			type="text"
			placeholder="Search notes..."
		/>
	</header>

	<div class="layout">
		<aside class="sidebar">
			<p class="sidebar-title">TABLE OF CONTENTS</p>

			<nav>
				<ul class="toc">
					{#each toc as item (item.title)}
						<li>
							<a href={item.href}>{item.title}</a>

							{#if item.children}
								<ul>
									{#each item.children as child (child.title)}
										<li>
											<a href={child.href}>
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
		</aside>

		<main class="content">
			<section id="introduction">
				<h1>Introduction</h1>
				<p>
					A clean static knowledge base built with
					SvelteKit ⚡
				</p>
			</section>

			<section id="getting-started">
				<h2>Getting Started</h2>

				<section id="installation">
					<h3>Installation</h3>
					<p>
						Run npm install and begin shipping pixels.
					</p>
				</section>

				<section id="folder-structure">
					<h3>Folder Structure</h3>
					<p>
						Organize content like a civilized engineer.
					</p>
				</section>
			</section>

			<section id="advanced">
				<h2>Advanced</h2>

				<section id="rendering">
					<h3>Rendering</h3>
					<p>
						Static prerendering goes brrrr 🚀
					</p>
				</section>

				<section id="deployment">
					<h3>Deployment</h3>
					<p>
						Deploy anywhere with static hosting.
					</p>
				</section>
			</section>
		</main>
	</div>
</div>

<style>
	:global(body) {
		margin: 0;
		font-family:
			Inter,
			system-ui,
			sans-serif;
		background: #0b0d12;
		color: #f5f7fa;
	}

	:global(*) {
		box-sizing: border-box;
	}

	.app {
		height: 100vh;
		display: flex;
		flex-direction: column;
	}

	.topbar {
		height: 64px;
		padding: 0 1.5rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
		border-bottom: 1px solid #1d2330;
		background: rgba(11, 13, 18, 0.85);
		backdrop-filter: blur(12px);
		position: sticky;
		top: 0;
		z-index: 10;
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-weight: 700;
		font-size: 1rem;
	}

	.logo {
		color: #7c9cff;
		font-size: 1.2rem;
	}

	.search {
		width: 240px;
		padding: 0.7rem 0.9rem;
		border-radius: 12px;
		border: 1px solid #252c3a;
		background: #131722;
		color: white;
		outline: none;
	}

	.search::placeholder {
		color: #7f8899;
	}

	.layout {
		flex: 1;
		display: grid;
		grid-template-columns: 280px 1fr;
		min-height: 0;
	}

	.sidebar {
		padding: 1.25rem;
		border-right: 1px solid #1d2330;
		background: #0f131b;
		overflow-y: auto;
	}

	.sidebar-title {
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		color: #7f8899;
		margin-bottom: 1rem;
	}

	.toc,
	.toc ul {
		list-style: none;
		padding-left: 0;
		margin: 0;
	}

	.toc ul {
		margin-left: 1rem;
		padding-left: 0.75rem;
		border-left: 1px solid #222938;
	}

	.toc li {
		margin: 0.25rem 0;
	}

	.toc a {
		display: block;
		padding: 0.55rem 0.75rem;
		border-radius: 10px;
		color: #d7dcea;
		text-decoration: none;
		font-size: 0.95rem;
		transition:
			background 120ms ease,
			color 120ms ease;
	}

	.toc a:hover {
		background: #1a2130;
		color: white;
	}

	.content {
		padding: 3rem;
		overflow-y: auto;
		max-width: 900px;
		width: 100%;
	}

	section {
		scroll-margin-top: 96px;
		margin-bottom: 3rem;
	}

	h1,
	h2,
	h3 {
		line-height: 1.1;
	}

	h1 {
		font-size: 3rem;
		margin-bottom: 1rem;
	}

	h2 {
		font-size: 2rem;
		margin-bottom: 1rem;
		margin-top: 3rem;
	}

	h3 {
		font-size: 1.25rem;
		margin-bottom: 0.75rem;
		margin-top: 2rem;
	}

	p {
		color: #b6bfd0;
		line-height: 1.7;
		max-width: 70ch;
	}
</style>
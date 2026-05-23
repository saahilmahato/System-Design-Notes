<script lang="ts">
	import Sidebar from '$lib/components/Sidebar.svelte';
</script>

<svelte:head>
	<title>System Design Notes</title>
</svelte:head>

<div class="app">
	<header class="topbar">
		<div class="brand">
			<span class="logo">✦</span>
			<span>System Design Notes</span>
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

			<Sidebar />
		</aside>

		<main class="content">
			<slot />
		</main>
	</div>
</div>

<style>
	:global(body) {
		margin: 0;
		font-family: Inter, system-ui, sans-serif;
		background: #0b0d12;
		color: #f5f7fa;
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
		background: #0b0d12;
	}

	.layout {
		flex: 1;
		display: grid;
		grid-template-columns: 280px 1fr;
	}

	.sidebar {
		padding: 1.25rem;
		border-right: 1px solid #1d2330;
		background: #0f131b;
		overflow-y: auto;
	}

	.content {
		padding: 3rem;
		overflow-y: auto;
	}

	.search {
		width: 240px;
		padding: 0.7rem 0.9rem;
		border-radius: 12px;
		border: 1px solid #252c3a;
		background: #131722;
		color: white;
	}
</style>
// ---------------------------------------------------------------------------
// 01Design — data-driven project catalog
//
// All projects live in projects.json (the single source of truth). This file
// renders the project cards and their modal containers from that data, then
// wires up modal open/close and category filtering.
// ---------------------------------------------------------------------------

// Build one project card (the clickable tile in the grid).
function buildCard(project) {
    const card = document.createElement('div');
    card.className = 'open-modal-button modal-button';
    card.id = project.id;
    card.dataset.modalTarget = `#modal-${project.id}`;
    card.dataset.categories = (project.categories || []).join(' ');
    card.style.backgroundImage = `url('${project.thumb}')`;

    const label = document.createElement('p');
    label.textContent = project.title;
    card.appendChild(label);
    return card;
}

// Build one filter button. Pass id '' for the "All" button (shows everything).
function buildFilterButton(id, label) {
    const button = document.createElement('button');
    button.className = 'filter-btn';
    button.dataset.category = id;
    button.textContent = label;
    button.addEventListener('click', function () {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        button.classList.add('active');
        filterProjects(id);
    });
    return button;
}

// Build the empty modal container that its content gets fetched into on click.
function buildModalContainer(project) {
    const modal = document.createElement('div');
    modal.id = `modal-${project.id}`;
    modal.className = 'modal';
    return modal;
}

// Fetch the modal fragment for a project (once) and reveal it.
function openModal(project, modalContainer) {
    if (modalContainer.classList.contains('loaded')) {
        modalContainer.style.display = 'block';
        return;
    }
    fetch(`modals/${project.id}_modal_content.html`)
        .then(response => response.text())
        .then(html => {
            modalContainer.innerHTML = html;
            modalContainer.classList.add('loaded');
            modalContainer.querySelectorAll('.close').forEach(closeBtn => {
                closeBtn.addEventListener('click', () => {
                    modalContainer.style.display = 'none';
                });
            });
            modalContainer.style.display = 'block';
            if (project.id === 'controlGAN') {
                attachControlGANVideoSlider();
            }
        })
        .catch(error => console.error(error));
}

function closeAllModals() {
    document.querySelectorAll('.modal').forEach(modal => {
        modal.style.display = 'none';
    });
}

// Show only cards that belong to the given category ('' shows all).
function filterProjects(category) {
    document.querySelectorAll('.modal-button').forEach(card => {
        const categories = card.dataset.categories.split(' ');
        const show = category === '' || categories.includes(category);
        card.style.display = show ? '' : 'none';
    });
}

// Random glow on the top-nav items when hovered.
function attachNavHoverEffect() {
    document.querySelectorAll('.topnavitem').forEach(item => {
        item.addEventListener('mouseover', function () {
            const color = '#' + Math.floor(Math.random() * 16777215).toString(16);
            this.style.boxShadow = `0px 0px 10px 1px ${color}`;
        });
        item.addEventListener('mouseout', function () {
            this.style.boxShadow = 'none';
        });
    });
}

// Custom video scrubber used inside the controlGAN modal.
function attachControlGANVideoSlider() {
    const video = document.getElementById('myVideo');
    const slider = document.getElementById('videoSlider');
    const bufferedSlider = document.getElementById('bufferedSlider');
    if (!video || !slider) return;

    function updateLoadingProgress() {
        if (video.buffered.length > 0 && bufferedSlider) {
            const bufferEnd = video.buffered.end(video.buffered.length - 1);
            const bufferedPercent = (bufferEnd / video.duration) * 100;
            bufferedSlider.style.backgroundSize = bufferedPercent + '% 100%';
        }
    }

    video.addEventListener('timeupdate', updateLoadingProgress);
    video.addEventListener('loadedmetadata', function () {
        slider.max = video.duration;
        if (bufferedSlider) bufferedSlider.max = video.duration;
        updateLoadingProgress();
    });
    video.addEventListener('timeupdate', function () {
        slider.value = video.currentTime;
    });
    slider.addEventListener('input', function () {
        video.currentTime = slider.value;
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const grid = document.getElementById('project-grid');
    const modalRoot = document.getElementById('modal-root');
    const filterBar = document.getElementById('filter-bar');

    // Filter buttons come from the category taxonomy in categories.json,
    // followed by an "All" button (active by default) that clears the filter.
    fetch('categories.json')
        .then(response => response.json())
        .then(categories => {
            categories.forEach(category => {
                filterBar.appendChild(buildFilterButton(category.id, category.label));
            });
            const allButton = buildFilterButton('', 'All');
            allButton.classList.add('active');
            filterBar.appendChild(allButton);
        })
        .catch(error => console.error('Could not load categories.json:', error));

    // Cards and modal containers come from projects.json.
    fetch('projects.json')
        .then(response => response.json())
        .then(projects => {
            projects.forEach(project => {
                const card = buildCard(project);
                const modalContainer = buildModalContainer(project);
                grid.appendChild(card);
                modalRoot.appendChild(modalContainer);
                card.addEventListener('click', () => openModal(project, modalContainer));
            });
        })
        .catch(error => console.error('Could not load projects.json:', error));

    attachNavHoverEffect();
});

// Close a modal when clicking the dimmed backdrop, or on Escape.
window.addEventListener('click', event => {
    if (event.target.classList.contains('modal')) closeAllModals();
});
document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeAllModals();
});

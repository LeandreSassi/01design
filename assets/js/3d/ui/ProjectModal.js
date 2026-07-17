// Fetches and shows a project's modal fragment inside a root container,
// reusing the exact same modals/*.html fragments as the 2D site.
export class ProjectModal {
    constructor(rootEl) {
        this.root = rootEl;

        window.addEventListener('click', e => {
            if (e.target.classList && e.target.classList.contains('modal')) e.target.style.display = 'none';
        });
        window.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                this.root.querySelectorAll('.modal').forEach(m => (m.style.display = 'none'));
            }
        });
    }

    open(id) {
        let container = document.getElementById('modal-' + id);
        if (!container) {
            container = document.createElement('div');
            container.id = 'modal-' + id;
            container.className = 'modal';
            this.root.appendChild(container);
        }
        if (container.classList.contains('loaded')) {
            container.style.display = 'block';
            return;
        }
        fetch(`modals/${id}_modal_content.html`)
            .then(r => r.text())
            .then(html => {
                container.innerHTML = html;
                container.classList.add('loaded');
                container.querySelectorAll('.close').forEach(btn =>
                    btn.addEventListener('click', () => (container.style.display = 'none')));
                container.style.display = 'block';
            })
            .catch(err => console.error(err));
    }
}

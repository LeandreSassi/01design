import { PHYSICS } from '../config.js';

// The drop/fall state machine shared by every project mesh. Pure behaviour —
// operates on any mesh with the `userData` shape ProjectObjectFactory creates.
export const DropPhysics = {
    dropIn(mesh) {
        const u = mesh.userData;
        mesh.visible = true;
        mesh.rotation.set(0, 0, 0);
        mesh.position.set(
            u.home.x,
            u.home.y + PHYSICS.dropHeight + Math.random() * PHYSICS.dropJitter,
            u.home.z
        );
        u.vy = 0;
        u.state = 'dropping';
    },

    /** Released meshes are flung outward and tumble down off the block. */
    startRemove(mesh) {
        const u = mesh.userData;
        u.state = 'falling';
        u.vy = 0.04;
        const len = Math.hypot(u.home.x, u.home.z) || 1;
        u.vx = (u.home.x / len) * 0.06 + (Math.random() - 0.5) * 0.03;
        u.vz = (u.home.z / len) * 0.06 + (Math.random() - 0.5) * 0.03;
        u.wx = (Math.random() - 0.5) * 0.14;
        u.wz = (Math.random() - 0.5) * 0.14;
    },

    /** Advance one mesh by one frame. */
    step(mesh) {
        const u = mesh.userData;
        if (u.state === 'dropping') {
            u.vy -= PHYSICS.gravity;
            mesh.position.y += u.vy;
            if (mesh.position.y <= u.home.y) {
                mesh.position.y = u.home.y;
                u.vy = -u.vy * PHYSICS.bounce;
                if (Math.abs(u.vy) < PHYSICS.settleSpeed) { u.vy = 0; u.state = 'home'; }
            }
        } else if (u.state === 'falling') {
            u.vy -= PHYSICS.gravity;
            mesh.position.x += u.vx;
            mesh.position.z += u.vz;
            mesh.position.y += u.vy;
            mesh.rotation.x += u.wx;
            mesh.rotation.z += u.wz;
            if (mesh.position.y < PHYSICS.floorOut) { mesh.visible = false; u.state = 'hidden'; }
        }
    },

    /** Ease the hover-scale bounce. Skips meshes mid fall/removal. */
    stepScale(mesh, isHovered) {
        const u = mesh.userData;
        if (u.state === 'falling' || u.state === 'hidden') return;
        const target = (isHovered ? PHYSICS.hoverScale : 1) * u.baseScale;
        u.scale += (target - u.scale) * PHYSICS.scaleLerp;
        mesh.scale.setScalar(u.scale);
    }
};

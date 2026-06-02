export const openCamera = (onCapture) => {
  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: black;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  `;

  modal.innerHTML = `
    <div style="position: absolute; top: 20px; right: 20px; z-index: 10000;">
      <button id="upload-btn" class="btn btn-primary" style="display: flex; align-items: center; gap: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.5);">
        <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
        Upload File
      </button>
      <input type="file" id="file-upload" accept="image/*" style="display: none;" />
    </div>
    <video id="camera-view" autoplay playsinline style="width: 100%; max-height: 80%; object-fit: cover;"></video>
    <div style="position: absolute; bottom: 40px; display: flex; gap: 20px; align-items: center;">
      <button id="cancel-camera" class="btn btn-outline" style="color: white; border-color: white;">Cancel</button>
      <button id="capture-btn" class="btn btn-secondary" style="width: 80px; height: 80px; border-radius: 50%; border: 4px solid white; box-shadow: 0 4px 12px rgba(0,0,0,0.5);"></button>
    </div>
    <canvas id="camera-canvas" style="display: none;"></canvas>
  `;

  document.body.appendChild(modal);

  const video = modal.querySelector('#camera-view');
  const canvas = modal.querySelector('#camera-canvas');
  const captureBtn = modal.querySelector('#capture-btn');
  const cancelBtn = modal.querySelector('#cancel-camera');
  const uploadBtn = modal.querySelector('#upload-btn');
  const fileUpload = modal.querySelector('#file-upload');

  let stream = null;

  navigator.mediaDevices.getUserMedia({ 
    video: { facingMode: 'environment' }, 
    audio: false 
  }).then(s => {
    stream = s;
    video.srcObject = stream;
  }).catch(err => {
    // Notify the user but leave modal open so they can still use the Upload button
    if (window.notify) {
      notify.warning('Camera not found or permission denied. You can still upload a file.');
    }
  });

  captureBtn.onclick = () => {
    if (!stream) {
      if (window.notify) notify.error('Camera not available. Please use the Upload File option instead.');
      return;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg');
    
    // Stop stream
    stream.getTracks().forEach(track => track.stop());
    document.body.removeChild(modal);
    
    onCapture(dataUrl);
  };

  uploadBtn.onclick = () => fileUpload.click();

  fileUpload.onchange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (stream) stream.getTracks().forEach(track => track.stop());
        document.body.removeChild(modal);
        onCapture(event.target.result);
      };
      reader.readAsDataURL(file);
    }
  };

  cancelBtn.onclick = () => {
    if (stream) stream.getTracks().forEach(track => track.stop());
    document.body.removeChild(modal);
  };
};

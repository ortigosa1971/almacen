// UI auth helpers (solo frontend).
// - Usa sessionStorage para que al cerrar el navegador se cierre la sesión.
// - Botón "Salir" en cualquier página.
(function(){
  window.logout = function(){
    try{
      sessionStorage.removeItem("usuario");
      sessionStorage.removeItem("rol");
      // por compatibilidad: limpia posibles restos antiguos
      localStorage.removeItem("usuario");
      localStorage.removeItem("rol");
    }catch(e){}
    window.location.href = "index.html";
  };
})();
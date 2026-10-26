import { products } from "./products.js";

const money = n => new Intl.NumberFormat("ru-RU", {style:"currency",currency:"RUB",maximumFractionDigits:0}).format(n);
const state = {category:"all", search:"", cart: readCart()};
const $ = id => document.getElementById(id);
const categoryNames = {fruit:"Фрукты",vegetable:"Овощи",greens:"Зелень"};

function readCart(){ try { return JSON.parse(localStorage.getItem("zk-cart") || "{}"); } catch { return {}; } }
function saveCart(){ localStorage.setItem("zk-cart",JSON.stringify(state.cart)); }
function toast(message){ const el=$("toast"); el.textContent=message; el.classList.add("visible"); setTimeout(()=>el.classList.remove("visible"),2300); }

function renderCatalog(){
  const list=products.filter(p=>(state.category==="all"||p.category===state.category)&&p.name.toLowerCase().includes(state.search.toLowerCase()));
  $("catalog").innerHTML=list.length?list.map(p=>`
    <article class="product-card">
      <div class="product-art" style="--art-bg:${p.bg}"><span>${p.emoji}</span></div>
      <div class="product-category">${categoryNames[p.category]}</div>
      <div class="product-name">${escapeHtml(p.name)}</div>
      <div class="product-description">${escapeHtml(p.description)}</div>
      <div class="product-bottom"><div class="product-price">${money(p.price)} <span class="product-unit">/ ${p.unit}</span></div>
      <button class="add-button" data-add="${p.id}" aria-label="Добавить: ${escapeHtml(p.name)}">+</button></div>
    </article>`).join(""):`<div class="empty-results">Ничего не найдено. Попробуйте другой запрос.</div>`;
  $("catalog").querySelectorAll("[data-add]").forEach(b=>b.addEventListener("click",()=>{addToCart(b.dataset.add);toast("Добавлено в корзину");}));
}
function escapeHtml(value){return String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function addToCart(id){state.cart[id]=(state.cart[id]||0)+1;saveCart();renderCart();}
function changeQty(id,delta){state.cart[id]=(state.cart[id]||0)+delta;if(state.cart[id]<=0)delete state.cart[id];saveCart();renderCart();}
function cartLines(){return Object.entries(state.cart).map(([id,qty])=>({product:products.find(p=>p.id===id),qty})).filter(x=>x.product);}
function renderCart(){
  const lines=cartLines(), count=lines.reduce((s,x)=>s+x.qty,0), subtotal=lines.reduce((s,x)=>s+x.product.price*x.qty,0);
  $("cart-count").textContent=count;$("cart-subtotal").textContent=money(subtotal);
  $("cart-empty").classList.toggle("hidden",lines.length>0);$("cart-items").classList.toggle("hidden",!lines.length);
  $("checkout-button").disabled=!lines.length;
  $("cart-items").innerHTML=lines.map(({product:p,qty})=>`
    <div class="cart-item"><div class="cart-item-art">${p.emoji}</div><div><div class="cart-item-name">${escapeHtml(p.name)}</div><div class="cart-item-price">${money(p.price)} / ${p.unit}</div></div>
    <div class="quantity-control"><button data-qty="${p.id}" data-delta="-1" aria-label="Уменьшить">−</button><span>${qty}</span><button data-qty="${p.id}" data-delta="1" aria-label="Увеличить">+</button></div></div>`).join("");
  $("cart-items").querySelectorAll("[data-qty]").forEach(b=>b.addEventListener("click",()=>changeQty(b.dataset.qty,Number(b.dataset.delta))));
}
function openCart(){ $("overlay").classList.remove("hidden");$("cart-drawer").classList.add("open");$("cart-drawer").setAttribute("aria-hidden","false");document.body.style.overflow="hidden";}
function closeCart(){ $("overlay").classList.add("hidden");$("cart-drawer").classList.remove("open");$("cart-drawer").setAttribute("aria-hidden","true");document.body.style.overflow="";}
function openCheckout(){closeCart();$("checkout-modal").classList.remove("hidden");$("form-result").classList.add("hidden");}
function closeCheckout(){$("checkout-modal").classList.add("hidden");document.body.style.overflow="";}
$("category-tabs").querySelectorAll("[data-category]").forEach(b=>b.addEventListener("click",()=>{state.category=b.dataset.category;$("category-tabs").querySelectorAll("button").forEach(x=>x.classList.toggle("active",x===b));renderCatalog();}));
$("search").addEventListener("input",e=>{state.search=e.target.value.trim();renderCatalog();});
$("open-cart").addEventListener("click",openCart);$("close-cart").addEventListener("click",closeCart);$("overlay").addEventListener("click",closeCart);
$("checkout-button").addEventListener("click",openCheckout);$("close-checkout").addEventListener("click",closeCheckout);
$("checkout-modal").addEventListener("click",e=>{if(e.target===$("checkout-modal"))closeCheckout();});

$("checkout-form").addEventListener("submit", async e => {
  e.preventDefault();

  const form = e.currentTarget;
  if (!form.reportValidity()) return;

  const lines = cartLines();
  if (!lines.length) return;

  const button = form.querySelector('button[type="submit"]');
  const result = $("form-result");

  button.disabled = true;
  button.textContent = "Отправка...";
  result.classList.add("hidden");

  try {
    const response = await fetch(
      "/.netlify/functions/create-order",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.elements.name.value.trim(),
          phone: form.elements.phone.value.trim(),
          address: form.elements.address.value.trim(),
          note: form.elements.note.value.trim(),
          items: lines.map(({ product, qty }) => ({
            productId: product.id,
            quantity: qty
          }))
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Ошибка отправки заказа");
    }

    result.textContent = data.message || data.warning ||
      "Заявка обработана.";
    result.classList.remove("hidden");

    if (response.status === 201) {
      state.cart = {};
      saveCart();
      renderCart();
      form.reset();
    }
  } catch (error) {
    result.textContent =
      error.message || "Не удалось связаться с сервером.";
    result.classList.remove("hidden");
  } finally {
    button.disabled = false;
    button.textContent = "Проверить заявку в демо-режиме";
  }

});
renderCatalog();renderCart();

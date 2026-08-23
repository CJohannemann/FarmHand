-- FarmHand — system default vocabularies (farm_id null = available to all farms)
-- Farms add their own terms alongside these; nothing here is mandatory.

-- ------------------------------------------------------------- species --

insert into term (farm_id, vocabulary, name) values
  (null,'species','Cattle'), (null,'species','Pig'),
  (null,'species','Chicken'), (null,'species','Turkey'),
  (null,'species','Duck'),   (null,'species','Goose'),
  (null,'species','Sheep'),  (null,'species','Goat'),
  (null,'species','Rabbit'), (null,'species','Horse'),
  (null,'species','Honeybee');

-- Breeds hang off their species. A starting set only — most farms add theirs.

insert into term (farm_id, vocabulary, name, parent_id)
select null,'breed', b.name,
       (select id from term
         where vocabulary='species' and name=b.species and farm_id is null)
from (values
  ('Angus','Cattle'), ('Hereford','Cattle'), ('Jersey','Cattle'),
  ('Highland','Cattle'), ('Dexter','Cattle'),
  ('Berkshire','Pig'), ('Tamworth','Pig'), ('Duroc','Pig'),
  ('Large Black','Pig'), ('Kunekune','Pig'),
  ('Rhode Island Red','Chicken'), ('Barred Rock','Chicken'),
  ('Buff Orpington','Chicken'), ('Australorp','Chicken'),
  ('Cornish Cross','Chicken'), ('Freedom Ranger','Chicken'),
  ('Easter Egger','Chicken'),
  ('Katahdin','Sheep'), ('Dorper','Sheep'),
  ('Nigerian Dwarf','Goat'), ('Boer','Goat')
) as b(name, species);

-- ------------------------------------------------------------ materials --

insert into term (farm_id, vocabulary, name) values
  (null,'material','Feed'),        (null,'material','Hay'),
  (null,'material','Straw'),       (null,'material','Bedding'),
  (null,'material','Seed'),        (null,'material','Fertilizer'),
  (null,'material','Compost'),     (null,'material','Medicine'),
  (null,'material','Mineral'),     (null,'material','Fuel'),
  (null,'material','Meat'),        (null,'material','Eggs'),
  (null,'material','Milk'),        (null,'material','Honey'),
  (null,'material','Produce'),     (null,'material','Firewood'),
  (null,'material','Canning supplies');

-- ----------------------------------------------- processing methods --

insert into term (farm_id, vocabulary, name) values
  (null,'method','Butchering'),  (null,'method','Canning'),
  (null,'method','Freezing'),    (null,'method','Curing'),
  (null,'method','Smoking'),     (null,'method','Fermenting'),
  (null,'method','Dehydrating'), (null,'method','Rendering'),
  (null,'method','Pressing'),    (null,'method','Milling'),
  (null,'method','Cheesemaking');

-- ------------------------------------------------------------ treatments --

insert into term (farm_id, vocabulary, name) values
  (null,'treatment','Vaccination'), (null,'treatment','Deworming'),
  (null,'treatment','Antibiotic'),  (null,'treatment','Hoof trim'),
  (null,'treatment','Castration'),  (null,'treatment','Dehorning'),
  (null,'treatment','Mite treatment');

-- ----------------------------------------------------------------- units --

-- Units are terms so farms can add odd local ones (bales, totes, flats)
-- without a migration. Conversion tables come later, if ever.

insert into term (farm_id, vocabulary, name) values
  (null,'unit','lb'),     (null,'unit','oz'),    (null,'unit','kg'),
  (null,'unit','g'),      (null,'unit','ton'),
  (null,'unit','gal'),    (null,'unit','qt'),    (null,'unit','pt'),
  (null,'unit','fl oz'),  (null,'unit','L'),     (null,'unit','mL'),
  (null,'unit','head'),   (null,'unit','dozen'), (null,'unit','each'),
  (null,'unit','bale'),   (null,'unit','bushel'),(null,'unit','jar'),
  (null,'unit','acre'),   (null,'unit','sq ft'), (null,'unit','ha'),
  (null,'unit','hour'),   (null,'unit','minute'),(null,'unit','USD');

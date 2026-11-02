// Manually curated for QuickKee; no external word list or dataset.
export const NAME_WORDS = {
  adjectives: `
    mellow agile airy amber ample ancient arctic autumn
    azure balanced bashful bold bouncy brave breezy bright
    brisk bubbly calm candid careful cheerful clever cloudless
    cozy crisp curious daring dashing dazzling gentle dreamy
    eager early earthy easy emerald endless even fancy
    fearless festive fiery fleet floral fluffy focused forest
    frank fresh friendly frosty fuzzy gallant gifted glad
    gleaming golden graceful grand grateful green happy hardy
    hazy hearty hidden honest humble icy idle indigo
    jolly joyful keen kind leafy light lively lofty
    lucky lunar lush magic merry mighty misty modest
    nimble noble novel oceanic olive open orange patient
    peaceful pearly playful plucky plush polished proud purple
    quiet radiant rapid ready regal rosy round royal
    rustic sandy serene shiny silent silver sleek snowy
    solar spry steady stellar sunny swift tidy vivid
  `.trim().split(/\s+/),
  nouns: `
    otter mango orbit acorn anchor apple arch arrow
    atlas aurora bamboo beacon berry birch blossom breeze
    brook bubble cactus candle canyon castle cedar cherry
    chime circle citadel cloud clover coast comet compass
    coral cosmos cove crystal dawn delta desert dewdrop
    dune echo ember feather fern field flame flute
    forest fountain frost galaxy garden gem glade glacier
    grove harbor harmony haven hill horizon island ivy
    jade jewel journey juniper kite lagoon lake lantern
    laurel leaf lemon lily lotus maple marble meadow
    melody mesa meteor mint moon moss mountain nectar
    night oasis ocean opal orchard pebble petal pine
    planet plum pond prism quartz rain rainbow reef
    ridge ripple river rock rose sail sand seed
    shadow shell shore sky snow spark spring star
    stone summit sunrise sunset tide trail valley willow
  `.trim().split(/\s+/),
  colors: `
    amber aqua azure beige blue bronze brown coral
    cream crimson cyan emerald gold gray green indigo
    ivory jade lavender lilac lime magenta maroon mint
    navy olive orange peach pink purple silver teal
  `.trim().split(/\s+/),
  animals: `
    falcon albatross alpaca ant antelope armadillo badger bat
    bear beaver bee beetle bison bluebird bobcat buffalo
    butterfly camel capybara cardinal caribou cat cheetah chickadee
    chipmunk cicada cobra cockatoo condor cougar coyote crab
    crane cricket crow deer dingo dolphin dove dragonfly
    duck eagle echidna eel egret elephant elk emu
    ferret finch firefly flamingo fox frog gazelle gecko
    gerbil gibbon giraffe goat goldfinch goose gopher gorilla
    grasshopper gull hamster hare hawk hedgehog heron horse
    hummingbird hyena ibex ibis iguana impala jackal jaguar
    jay jellyfish kangaroo kestrel kingfisher kiwi koala koi
    lemur leopard lion lizard llama lobster loon lynx
    macaw magpie manatee marmot meerkat mink mole mongoose
    moose moth mouse narwhal newt ocelot octopus orca
    osprey ostrich otter owl panda panther parrot peacock
    pelican penguin puffin rabbit raccoon raven robin seal
  `.trim().split(/\s+/),
  firstNames: `
    sam alex aaron abel ada adam adrian aiden
    alan alba alice alma amara amber amir amy
    ana andre andy anya aria arlo arun asha
    asher atlas ava beau bella ben blair blake
    brooke caleb cameron cara carla carlo casey celia
    charlie chloe clara cleo cody cora dana daniel
    dara david dawn dean dylan eden eli elena
    elias elise ella ellis emery emma eric erin
    esme ethan eva evan ezra felix finn flora
    frank freya gabe gaia grace hana harper hazel
    hugo ida imani iris isaac isla ivan ivy
    jack jade jamie jane jasper jay jesse joel
    jonah jordan jules june kai kara keira kian
    kira lana lara laura leah leo leon levi
    lia liam lily lina logan lola luca lucy
    luna maya mia mila mira noah nora owen
  `.trim().split(/\s+/),
  surnames: `
    parker adams allen archer ashton avery bailey baker
    banks barnes barrett barton baxter bell bennett benson
    bishop blake bowen boyd brady brooks brown burke
    burns byrd campbell carter casey chandler chase clark
    clay cole collins cook cooper craig cross curtis
    dale dalton davis dawson dean dixon douglas drake
    drew duncan ellis emerson evans fairfax fields finch
    fisher fletcher flynn ford foster fox franklin frost
    gardner gibson grant gray green griffin hall hardy
    harper harris hart harvey hayes heath hill holden
    holmes hood howard hudson hunter irwin james jensen
    jones jordan keller kelly kennedy kent king knight
    lane lang lawson lee lewis long lowe lucas
    lynch mason may mills mitchell moore morgan morris
    nash nelson newman nolan north oliver owens page
    palmer payne perry porter quinn reed rivers stone
  `.trim().split(/\s+/),
} as const;
